use serde_json::{json, Value};

pub fn command_error() -> Value {
    json!({"type":"error","seq":null,"code":"invalid-command","message":"Invalid native command frame"})
}

// The owning JS worker uses positive safe-integer request identifiers. A bad
// frame has no trustworthy sequence to acknowledge, and terminates the stream.
pub fn parse_command(bytes: &[u8]) -> Result<Value, ()> {
    let command: Value = serde_json::from_slice(bytes).map_err(|_| ())?;
    if !command.is_object()
        || !command["seq"]
            .as_u64()
            .is_some_and(|seq| seq > 0 && seq <= 9_007_199_254_740_991)
    {
        return Err(());
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::parse_command;

    #[test]
    fn rejects_malformed_json_and_unacknowledgeable_sequences() {
        for frame in [
            "{",
            "null",
            "[]",
            "{}",
            r#"{"seq":0}"#,
            r#"{"seq":-1}"#,
            r#"{"seq":"1"}"#,
            r#"{"seq":1.5}"#,
            r#"{"seq":9007199254740992}"#,
        ] {
            assert!(parse_command(frame.as_bytes()).is_err(), "{frame}");
        }
        let command = parse_command(br#"{"seq":1,"op":"start","source":"system"}"#).unwrap();
        assert_eq!(command["seq"], 1);
    }
}
