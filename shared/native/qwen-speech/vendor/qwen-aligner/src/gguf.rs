//! Read the fixed Qwen3 ForcedAligner GGUF Q8_0 export without changing engines.
//! Quantized blocks stay mmap-backed until each CPU/CUDA tensor is constructed.
use crate::raw_tensor::RawTensor;
use anyhow::{anyhow, bail, ensure, Result};
use bytes::Bytes;
use memmap2::Mmap;
use safetensors::Dtype;
use std::{collections::HashMap, fs::File, path::Path};

struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self
            .position
            .checked_add(count)
            .ok_or_else(|| anyhow!("GGUF offset overflow"))?;
        let bytes = self
            .bytes
            .get(self.position..end)
            .ok_or_else(|| anyhow!("truncated GGUF"))?;
        self.position = end;
        Ok(bytes)
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into()?))
    }
    fn size(&mut self) -> Result<usize> {
        Ok(usize::try_from(u64::from_le_bytes(
            self.take(8)?.try_into()?,
        ))?)
    }
    fn string(&mut self) -> Result<&'a str> {
        let count = self.size()?;
        ensure!(count <= 1024 * 1024, "oversized GGUF string");
        Ok(std::str::from_utf8(self.take(count)?)?)
    }
    fn skip(&mut self, kind: u32, depth: usize) -> Result<()> {
        ensure!(depth <= 4, "nested GGUF metadata limit");
        match kind {
            0 | 1 | 7 => {
                self.take(1)?;
            }
            2 | 3 => {
                self.take(2)?;
            }
            4 | 5 | 6 => {
                self.take(4)?;
            }
            10 | 11 | 12 => {
                self.take(8)?;
            }
            8 => {
                self.string()?;
            }
            9 => {
                let element = self.u32()?;
                let count = self.size()?;
                ensure!(count <= 2_000_000, "oversized GGUF metadata array");
                for _ in 0..count {
                    self.skip(element, depth + 1)?;
                }
            }
            _ => bail!("unsupported GGUF metadata type {kind}"),
        }
        Ok(())
    }
}

fn original_name(name: &str) -> Result<Option<String>> {
    if matches!(name, "audio.mel_filters" | "audio.mel_window") {
        return Ok(None);
    }
    let direct = match name {
        "token_embd.weight" => Some("thinker.model.embed_tokens.weight"),
        "output.weight" => Some("thinker.lm_head.weight"),
        "output_norm.weight" => Some("thinker.model.norm.weight"),
        _ => None,
    };
    if let Some(name) = direct {
        return Ok(Some(name.into()));
    }
    if let Some(name) = name.strip_prefix("audio.conv.") {
        let (index, suffix) = name
            .split_once('.')
            .ok_or_else(|| anyhow!("invalid GGUF conv name"))?;
        ensure!(
            matches!(index, "1" | "2" | "3") && matches!(suffix, "weight" | "bias"),
            "invalid GGUF convolution"
        );
        return Ok(Some(format!("thinker.audio_tower.conv2d{index}.{suffix}")));
    }
    for stem in ["conv_out", "ln_post", "proj1", "proj2"] {
        if let Some(suffix) = name.strip_prefix(&format!("audio.{stem}.")) {
            ensure!(
                matches!(suffix, "weight" | "bias"),
                "invalid GGUF audio suffix"
            );
            return Ok(Some(format!("thinker.audio_tower.{stem}.{suffix}")));
        }
    }
    let (rest, audio) = if let Some(rest) = name.strip_prefix("audio.blk.") {
        (rest, true)
    } else if let Some(rest) = name.strip_prefix("blk.") {
        (rest, false)
    } else {
        bail!("unrecognized GGUF weight {name}");
    };
    let (index, rest) = rest
        .split_once('.')
        .ok_or_else(|| anyhow!("invalid GGUF layer"))?;
    let index: usize = index.parse()?;
    ensure!(
        index < if audio { 24 } else { 28 },
        "invalid GGUF layer index"
    );
    let (stem, suffix) = rest
        .rsplit_once('.')
        .ok_or_else(|| anyhow!("invalid GGUF layer suffix"))?;
    ensure!(
        matches!(suffix, "weight" | "bias") && (audio || suffix == "weight"),
        "invalid GGUF parameter suffix"
    );
    let stem = match (audio, stem) {
        (true, "attn_norm") => "self_attn_layer_norm",
        (true, "attn_out") => "self_attn.out_proj",
        (true, "ffn_norm") => "final_layer_norm",
        (true, "ffn_up") => "fc1",
        (true, "ffn_down") => "fc2",
        (false, "attn_norm") => "input_layernorm",
        (false, "attn_output") => "self_attn.o_proj",
        (false, "attn_q_norm") => "self_attn.q_norm",
        (false, "attn_k_norm") => "self_attn.k_norm",
        (false, "ffn_norm") => "post_attention_layernorm",
        (false, "ffn_gate") => "mlp.gate_proj",
        (false, "ffn_up") => "mlp.up_proj",
        (false, "ffn_down") => "mlp.down_proj",
        (_, "attn_q") => "self_attn.q_proj",
        (_, "attn_k") => "self_attn.k_proj",
        (_, "attn_v") => "self_attn.v_proj",
        _ => bail!("unrecognized GGUF layer parameter {name}"),
    };
    let tower = if audio { "audio_tower" } else { "model" };
    Ok(Some(format!(
        "thinker.{tower}.layers.{index}.{stem}.{suffix}"
    )))
}

fn parse(bytes: Bytes) -> Result<HashMap<String, RawTensor>> {
    let mut reader = Reader {
        bytes: &bytes,
        position: 0,
    };
    ensure!(
        reader.take(4)? == b"GGUF" && reader.u32()? == 3,
        "expected GGUF v3"
    );
    let tensor_count = reader.size()?;
    let metadata_count = reader.size()?;
    ensure!(
        tensor_count > 0 && tensor_count <= 4096 && metadata_count <= 512,
        "GGUF header count limit"
    );
    let mut alignment = 32usize;
    let mut architecture = false;
    let mut seen = std::collections::HashSet::new();
    for _ in 0..metadata_count {
        let name = reader.string()?;
        ensure!(seen.insert(name), "duplicate GGUF metadata");
        let kind = reader.u32()?;
        if name == "general.architecture" {
            ensure!(
                kind == 8 && reader.string()? == "qwen3asr",
                "unexpected GGUF architecture"
            );
            architecture = true;
        } else if name == "general.alignment" {
            ensure!(kind == 4, "invalid GGUF alignment type");
            alignment = reader.u32()? as usize;
            ensure!(
                alignment.is_power_of_two() && alignment <= 4096,
                "invalid GGUF alignment"
            );
        } else {
            reader.skip(kind, 0)?;
        }
    }
    ensure!(architecture, "GGUF architecture missing");
    let mut descriptions = Vec::with_capacity(tensor_count);
    let mut tensor_names = std::collections::HashSet::new();
    for _ in 0..tensor_count {
        let name = reader.string()?;
        ensure!(tensor_names.insert(name), "duplicate GGUF tensor");
        let dimensions = reader.u32()?;
        ensure!(
            (1..=4).contains(&dimensions),
            "unsupported GGUF tensor rank"
        );
        let mut shape = Vec::new();
        for _ in 0..dimensions {
            let n = reader.size()?;
            ensure!(n > 0, "zero GGUF dimension");
            shape.push(n);
        }
        shape.reverse(); // GGUF lists innermost dimensions first; bytes remain row-major.
        let kind = reader.u32()?;
        let offset = reader.size()?;
        ensure!(offset % alignment == 0, "unaligned GGUF tensor");
        let count = shape
            .iter()
            .try_fold(1usize, |n, d| n.checked_mul(*d))
            .ok_or_else(|| anyhow!("GGUF shape overflow"))?;
        let (dtype, q8_0, length) = match kind {
            0 => (Dtype::F32, false, count.checked_mul(4)),
            1 => (Dtype::F16, false, count.checked_mul(2)),
            8 => {
                ensure!(
                    count % 32 == 0 && shape.last().is_some_and(|n| n % 32 == 0),
                    "invalid Q8_0 row shape"
                );
                (
                    Dtype::I8,
                    true,
                    count.checked_div(32).and_then(|n| n.checked_mul(34)),
                )
            }
            _ => bail!("unsupported GGUF weight type {kind}; expected F32/F16/Q8_0"),
        };
        descriptions.push((
            original_name(name)?,
            shape,
            dtype,
            q8_0,
            offset,
            length.ok_or_else(|| anyhow!("GGUF byte size overflow"))?,
        ));
    }
    let start = reader
        .position
        .checked_add(alignment - 1)
        .ok_or_else(|| anyhow!("GGUF alignment overflow"))?
        / alignment
        * alignment;
    let mut ranges = Vec::new();
    let mut result = HashMap::new();
    for (name, shape, dtype, q8_0, offset, length) in descriptions {
        let begin = start
            .checked_add(offset)
            .ok_or_else(|| anyhow!("GGUF data offset overflow"))?;
        let end = begin
            .checked_add(length)
            .ok_or_else(|| anyhow!("GGUF data length overflow"))?;
        ensure!(end <= bytes.len(), "truncated GGUF tensor data");
        ranges.push((begin, end));
        if let Some(name) = name {
            ensure!(
                result
                    .insert(
                        name,
                        RawTensor {
                            data: bytes.slice(begin..end),
                            shape,
                            dtype,
                            q8_0
                        }
                    )
                    .is_none(),
                "duplicate remapped GGUF weight"
            );
        }
    }
    ranges.sort_unstable();
    ensure!(
        ranges.windows(2).all(|pair| pair[0].1 <= pair[1].0),
        "overlapping GGUF tensors"
    );
    Ok(result)
}

pub(crate) fn load(path: &Path) -> Result<HashMap<String, RawTensor>> {
    let file = File::open(path)?;
    // The independently authenticated managed model is read-only for its lifetime.
    let bytes = Bytes::from_owner(unsafe { Mmap::map(&file)? });
    let weights = parse(bytes)?;
    ensure!(
        weights.len() == 708
            && weights.values().any(|w| w.q8_0)
            && weights
                .get("thinker.lm_head.weight")
                .is_some_and(|w| w.shape == [5000, 1024])
            && weights
                .get("thinker.model.embed_tokens.weight")
                .is_some_and(|w| w.shape == [152064, 1024]),
        "GGUF is not the supported Qwen3 ForcedAligner 0.6B Q8_0 checkpoint"
    );
    Ok(weights)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn string(out: &mut Vec<u8>, value: &str) {
        out.extend((value.len() as u64).to_le_bytes());
        out.extend(value.as_bytes());
    }
    fn fixture(kind: u32, offset: u64) -> Vec<u8> {
        let mut bytes = b"GGUF".to_vec();
        bytes.extend(3u32.to_le_bytes());
        bytes.extend(1u64.to_le_bytes());
        bytes.extend(1u64.to_le_bytes());
        string(&mut bytes, "general.architecture");
        bytes.extend(8u32.to_le_bytes());
        string(&mut bytes, "qwen3asr");
        string(&mut bytes, "output.weight");
        bytes.extend(2u32.to_le_bytes());
        bytes.extend(32u64.to_le_bytes());
        bytes.extend(1u64.to_le_bytes());
        bytes.extend(kind.to_le_bytes());
        bytes.extend(offset.to_le_bytes());
        bytes.resize(bytes.len().div_ceil(32) * 32, 0);
        bytes.extend(half::f16::from_f32(0.25).to_le_bytes());
        bytes.extend([4u8; 32]);
        bytes
    }
    #[test]
    fn remaps_without_transposing_original_rows() {
        let tensors = parse(Bytes::from(fixture(8, 0))).unwrap();
        let t = &tensors["thinker.lm_head.weight"];
        assert_eq!(t.shape, [1, 32]);
        assert_eq!(t.to_f32_vec().unwrap(), vec![1.0; 32]);
        assert_eq!(
            original_name("audio.conv.2.weight").unwrap().unwrap(),
            "thinker.audio_tower.conv2d2.weight"
        );
        assert_eq!(
            original_name("audio.blk.23.ffn_up.bias").unwrap().unwrap(),
            "thinker.audio_tower.layers.23.fc1.bias"
        );
        assert_eq!(
            original_name("blk.27.attn_q_norm.weight").unwrap().unwrap(),
            "thinker.model.layers.27.self_attn.q_norm.weight"
        );
        assert!(original_name("audio.blk.24.ffn_up.weight").is_err());
        assert!(original_name("blk.0.unknown.weight").is_err());
    }
    #[test]
    fn malformed_container_fails_without_panic_or_allocating_from_counts() {
        let bytes = fixture(8, 0);
        for end in 0..bytes.len() {
            assert!(parse(Bytes::copy_from_slice(&bytes[..end])).is_err());
        }
        assert!(parse(Bytes::from(fixture(2, 0))).is_err());
        assert!(parse(Bytes::from(fixture(8, u64::MAX))).is_err());
        let mut invalid = bytes.clone();
        invalid[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(parse(Bytes::from(invalid)).is_err());
        let mut invalid = bytes;
        invalid[24..32].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(parse(Bytes::from(invalid)).is_err());
    }
}
