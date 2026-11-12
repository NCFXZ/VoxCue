//! Check the CPU kernel contract before any AVX2/FMA entry point is reachable.

fn supported_x86(avx2: bool, fma: bool) -> bool {
    avx2 && fma
}

pub fn supported() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        supported_x86(
            std::is_x86_feature_detected!("avx2"),
            std::is_x86_feature_detected!("fma"),
        )
    }
    #[cfg(target_arch = "aarch64")]
    {
        true
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::supported_x86;

    #[test]
    fn rejects_either_missing_cpu_feature() {
        assert!(!supported_x86(false, false));
        assert!(!supported_x86(false, true));
        assert!(!supported_x86(true, false));
        assert!(supported_x86(true, true));
    }
}
