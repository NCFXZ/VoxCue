//! Raw on-disk tensor view, backed by safetensors or GGUF model bytes.
//!
//! Used only for weight loading — never as a GPU/CPU computation tensor (those
//! live in `cudarc_engine` / `cpu_engine`).  `RawTensor` is a deserialization
//! intermediate; the engines consume the raw bytes and upload them to their
//! respective devices.
//!
//! `data` is a `bytes::Bytes` so it can share one mmap region across all
//! tensors via O(1) refcount+range slices (see `weights.rs` and `gguf.rs`).
//! Dense conversions remain bit-exact. GGUF Q8_0 blocks are decoded once into
//! the existing engine's computation precision when it constructs each tensor.

use anyhow::{anyhow, Result};
use bytes::Bytes;
use safetensors::Dtype;

/// One tensor as it sits in the safetensors file: raw bytes + shape + dtype.
#[derive(Debug, Clone)]
pub struct RawTensor {
    /// Raw little-endian bytes (f32 = 4 bytes, f16/bf16 = 2 bytes, etc.).
    /// Backed by a refcounted slice of the mmap'd file; cheap to clone.
    pub data: Bytes,
    pub shape: Vec<usize>,
    pub dtype: Dtype,
    /// GGML Q8_0: one little-endian fp16 scale and 32 signed int8 values.
    pub q8_0: bool,
}

impl RawTensor {
    /// Convert raw bytes to a `Vec<f32>`. Supports F32 / F16 / BF16 / Q8_0.
    #[allow(dead_code)]
    pub fn to_f32_vec(&self) -> Result<Vec<f32>> {
        if self.q8_0 {
            return self.decode_q8_0(|value| value);
        }
        match self.dtype {
            Dtype::F32 => Ok(self
                .data
                .chunks_exact(4)
                .map(|c| f32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                .collect()),
            Dtype::F16 => Ok(self
                .data
                .chunks_exact(2)
                .map(|c| half::f16::from_ne_bytes([c[0], c[1]]).to_f32())
                .collect()),
            Dtype::BF16 => Ok(self
                .data
                .chunks_exact(2)
                .map(|c| {
                    let b = u16::from_ne_bytes([c[0], c[1]]);
                    f32::from_bits((b as u32) << 16)
                })
                .collect()),
            other => Err(anyhow!("unsupported dtype {:?} for to_f32_vec", other)),
        }
    }

    /// Convert raw bytes to a `Vec<half::f16>`. Supports F32 / F16 / BF16.
    pub fn to_f16_vec(&self) -> Result<Vec<half::f16>> {
        if self.q8_0 {
            return self.decode_q8_0(half::f16::from_f32);
        }
        match self.dtype {
            Dtype::F16 => Ok(self
                .data
                .chunks_exact(2)
                .map(|c| half::f16::from_ne_bytes([c[0], c[1]]))
                .collect()),
            Dtype::F32 => Ok(self
                .data
                .chunks_exact(4)
                .map(|c| f32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                .map(half::f16::from_f32)
                .collect()),
            Dtype::BF16 => Ok(self
                .data
                .chunks_exact(2)
                .map(|c| {
                    let b = u16::from_ne_bytes([c[0], c[1]]);
                    half::f16::from_f32(f32::from_bits((b as u32) << 16))
                })
                .collect()),
            other => Err(anyhow!("unsupported dtype {:?} for to_f16_vec", other)),
        }
    }

    /// Convert raw bytes to a `Vec<half::bf16>`. Supports F32 / F16 / BF16.
    ///
    /// For BF16 on-disk storage (the common case for these checkpoints) this
    /// is a **bit-exact reinterpret cast** — no rounding — so the values
    /// loaded into the GPU match what Python's `torch.load(..., dtype=bfloat16)`
    /// sees, eliminating any dtype-mismatch drift in downstream argmax.
    pub fn to_bf16_vec(&self) -> Result<Vec<half::bf16>> {
        if self.q8_0 {
            return self.decode_q8_0(half::bf16::from_f32);
        }
        match self.dtype {
            Dtype::BF16 => Ok(self
                .data
                .chunks_exact(2)
                .map(|c| half::bf16::from_ne_bytes([c[0], c[1]]))
                .collect()),
            Dtype::F32 => Ok(self
                .data
                .chunks_exact(4)
                .map(|c| f32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                .map(half::bf16::from_f32)
                .collect()),
            Dtype::F16 => Ok(self
                .data
                .chunks_exact(2)
                .map(|c| half::f16::from_ne_bytes([c[0], c[1]]).to_f32())
                .map(half::bf16::from_f32)
                .collect()),
            other => Err(anyhow!("unsupported dtype {:?} for to_bf16_vec", other)),
        }
    }

    /// (f32_data, shape) — convenience for loaders that need both.
    #[allow(dead_code)]
    pub fn as_f32(&self) -> Result<(Vec<f32>, Vec<usize>)> {
        Ok((self.to_f32_vec()?, self.shape.clone()))
    }

    /// (f16_data, shape) — convenience for loaders that need both.
    pub fn as_f16(&self) -> Result<(Vec<half::f16>, Vec<usize>)> {
        Ok((self.to_f16_vec()?, self.shape.clone()))
    }

    /// (bf16_data, shape) — convenience for loaders that need both.
    pub fn as_bf16(&self) -> Result<(Vec<half::bf16>, Vec<usize>)> {
        Ok((self.to_bf16_vec()?, self.shape.clone()))
    }

    fn decode_q8_0<T>(&self, convert: impl Fn(f32) -> T) -> Result<Vec<T>> {
        let count = self
            .shape
            .iter()
            .try_fold(1usize, |n, d| n.checked_mul(*d))
            .ok_or_else(|| anyhow!("Q8_0 shape overflow"))?;
        anyhow::ensure!(
            count > 0
                && count % 32 == 0
                && self.shape.last().is_some_and(|n| n % 32 == 0)
                && count.checked_div(32).and_then(|n| n.checked_mul(34)) == Some(self.data.len()),
            "invalid Q8_0 tensor shape or byte length"
        );
        let mut output = Vec::with_capacity(count);
        for block in self.data.chunks_exact(34) {
            let scale = half::f16::from_le_bytes([block[0], block[1]]).to_f32();
            anyhow::ensure!(scale.is_finite(), "non-finite Q8_0 scale");
            output.extend(
                block[2..]
                    .iter()
                    .map(|q| convert(scale * (*q as i8 as f32))),
            );
        }
        Ok(output)
    }
}

#[cfg(test)]
mod quantized_tests {
    use super::*;
    fn tensor() -> RawTensor {
        let mut data = half::f16::from_f32(0.5).to_le_bytes().to_vec();
        data.extend((-16i8..16).map(|value| value as u8));
        RawTensor {
            data: Bytes::from(data),
            shape: vec![1, 32],
            dtype: Dtype::I8,
            q8_0: true,
        }
    }
    #[test]
    fn q8_signed_values_and_float_backends() {
        let tensor = tensor();
        let expected: Vec<f32> = (-16..16).map(|value| value as f32 * 0.5).collect();
        assert_eq!(tensor.to_f32_vec().unwrap(), expected);
        assert_eq!(
            tensor
                .to_f16_vec()
                .unwrap()
                .iter()
                .map(|v| v.to_f32())
                .collect::<Vec<_>>(),
            expected
        );
        assert_eq!(
            tensor
                .to_bf16_vec()
                .unwrap()
                .iter()
                .map(|v| v.to_f32())
                .collect::<Vec<_>>(),
            expected
        );
    }
    #[test]
    fn q8_rejects_truncation_shape_overflow_and_nonfinite_scale() {
        let mut value = tensor();
        value.data = value.data.slice(..33);
        assert!(value.to_f32_vec().is_err());
        value = tensor();
        value.shape = vec![2, 16];
        assert!(value.to_f32_vec().is_err());
        value.shape = vec![usize::MAX, 32];
        assert!(value.to_f32_vec().is_err());
        value = tensor();
        let mut bytes = value.data.to_vec();
        bytes[..2].copy_from_slice(&half::f16::INFINITY.to_le_bytes());
        value.data = Bytes::from(bytes);
        assert!(value.to_f32_vec().is_err());
    }
}
