use qwen_forced_aligner_rs::{AlignRequest, AudioInput, Qwen3ForcedAligner, TextInput};
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn four_sentences() {
        assert_eq!(ends("第一句。第二句？第三句！第四句。尾部草稿").len(), 4);
    }
    #[test]
    fn punctuation_clusters_and_closers() {
        assert_eq!(ends("Really?! Yes!\" Next. Last?").len(), 4);
    }
    #[test]
    fn decimals_and_abbreviations() {
        assert_eq!(ends("Dr. Smith has 3.14 dollars. Why?").len(), 2);
    }
}
pub fn norm(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn ender(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '!' | '?' | '.')
}
fn closer(c: char) -> bool {
    matches!(
        c,
        '”' | '’' | '"' | '\'' | '」' | '』' | '）' | ')' | ']' | '】'
    )
}
pub fn ends(s: &str) -> Vec<usize> {
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (p, c) = chars[i];
        if !ender(c) {
            i += 1;
            continue;
        }
        if c == '.' {
            let before = i.checked_sub(1).map(|j| chars[j].1);
            let after = chars.get(i + 1).map(|x| x.1);
            if before.is_some_and(|x| x.is_ascii_digit())
                && after.is_some_and(|x| x.is_ascii_digit())
            {
                i += 1;
                continue;
            }
            if after.is_some_and(|x| x.is_ascii_alphabetic()) {
                i += 1;
                continue;
            }
            let word = s[..p]
                .split_whitespace()
                .last()
                .unwrap_or("")
                .to_ascii_lowercase();
            if [
                "mr", "mrs", "ms", "dr", "prof", "vs", "sr", "jr", "e.g", "i.e",
            ]
            .contains(&word.as_str())
            {
                i += 1;
                continue;
            }
        }
        let mut j = i + 1;
        while j < chars.len() && (ender(chars[j].1) || closer(chars[j].1)) {
            j += 1;
        }
        let end = chars.get(j).map(|x| x.0).unwrap_or(s.len());
        let begin = out.last().copied().unwrap_or(0);
        if !norm(&s[begin..end]).is_empty() {
            out.push(end);
        }
        i = j;
    }
    out
}
pub fn align_cut(
    aligner: &Qwen3ForcedAligner,
    audio: &[f32],
    text: &str,
    first: &str,
) -> anyhow::Result<(usize, f64, f64)> {
    let language = if text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)) {
        "Chinese"
    } else {
        "English"
    };
    let result = aligner.align(AlignRequest::new(
        AudioInput::Waveform16Khz(audio.to_vec()),
        TextInput::Text(text.to_owned()),
        language,
    ))?;
    let target = norm(first);
    if target.is_empty() {
        anyhow::bail!("empty first sentence")
    }
    let mut accumulated = String::new();
    let mut last = None;
    for (i, item) in result.items.iter().enumerate() {
        let t = norm(&item.text);
        if t.is_empty() {
            continue;
        }
        accumulated.push_str(&t);
        if !target.starts_with(&accumulated) {
            anyhow::bail!("aligned words do not match the stable sentence")
        }
        if accumulated == target {
            last = Some(i);
            break;
        }
    }
    let i = last.ok_or_else(|| anyhow::anyhow!("sentence boundary missing in alignment"))?;
    let left = result.items[i].end_time;
    let next = result
        .items
        .iter()
        .skip(i + 1)
        .find(|x| !norm(&x.text).is_empty())
        .ok_or_else(|| anyhow::anyhow!("next sentence timestamp missing"))?;
    let right = next.start_time;
    let duration = audio.len() as f64 / 16000.;
    if !left.is_finite()
        || !right.is_finite()
        || left < 0.1
        || right < left
        || right > duration
        || right - left > 2.0
    {
        anyhow::bail!("sentence timestamps are not safe to crop")
    }
    // Midpoint of the aligned inter-word gap protects the next sentence's onset.
    let cut = ((left + right) * 0.5 * 16000.).round() as usize;
    if cut < 1600 || cut + 8000 > audio.len() {
        anyhow::bail!("insufficient audio around the cut")
    }
    Ok((cut, left, right))
}
