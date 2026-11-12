//! Local deadlines for the private macOS Rust/Python pipes; no background I/O thread.
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    os::{
        fd::AsRawFd,
        raw::{c_int, c_short},
    },
    time::Instant,
};

#[repr(C)]
struct PollFd {
    fd: c_int,
    events: c_short,
    revents: c_short,
}
extern "C" {
    fn poll(fds: *mut PollFd, count: u32, timeout: c_int) -> c_int;
    fn fcntl(fd: c_int, command: c_int, ...) -> c_int;
}
pub fn nonblocking(pipe: &impl AsRawFd) -> io::Result<()> {
    // Darwin fcntl.h: F_GETFL=3, F_SETFL=4, O_NONBLOCK=4.
    let flags = unsafe { fcntl(pipe.as_raw_fd(), 3) };
    if flags < 0 || unsafe { fcntl(pipe.as_raw_fd(), 4, flags | 4) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
fn wait(fd: c_int, events: c_short, deadline: Instant) -> io::Result<()> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "MLX pipe timed out",
            ));
        }
        let milliseconds = remaining.as_millis().clamp(1, c_int::MAX as u128) as c_int;
        let mut state = PollFd {
            fd,
            events,
            revents: 0,
        };
        let result = unsafe { poll(&mut state, 1, milliseconds) };
        if result > 0 {
            return Ok(());
        }
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}
pub fn write_all<W: Write + AsRawFd>(
    pipe: &mut W,
    mut bytes: &[u8],
    deadline: Instant,
) -> io::Result<()> {
    while !bytes.is_empty() {
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "MLX write timed out",
            ));
        }
        match pipe.write(bytes) {
            Ok(0) => return Err(io::Error::new(io::ErrorKind::WriteZero, "MLX pipe closed")),
            Ok(count) => bytes = &bytes[count..],
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait(pipe.as_raw_fd(), 4, deadline)?
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}
pub fn read_line<R: Read + AsRawFd>(
    pipe: &mut BufReader<R>,
    limit: usize,
    deadline: Instant,
) -> io::Result<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "MLX read timed out",
            ));
        }
        match (&mut *pipe)
            .take((limit + 1 - line.len()) as u64)
            .read_until(b'\n', &mut line)
        {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "MLX pipe closed",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait(pipe.get_ref().as_raw_fd(), 1, deadline)?;
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
        if line.len() > limit {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "MLX response too large",
            ));
        }
        if line.last() == Some(&b'\n') {
            return Ok(line);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::unix::net::UnixStream, time::Duration};
    fn deadline() -> Instant {
        Instant::now() + Duration::from_millis(100)
    }
    #[test]
    fn stalled_read_and_write_are_bounded() {
        let (mut local, _peer) = UnixStream::pair().unwrap();
        nonblocking(&local).unwrap();
        assert_eq!(
            read_line(
                &mut BufReader::new(local.try_clone().unwrap()),
                100,
                deadline()
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::TimedOut
        );
        assert_eq!(
            write_all(&mut local, &vec![0; 8 * 1024 * 1024], deadline())
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
    }
    #[test]
    fn partial_lines_eof_and_oversize_fail_without_losing_boundaries() {
        let (local, mut peer) = UnixStream::pair().unwrap();
        nonblocking(&local).unwrap();
        peer.write_all(b"ready\nack\n").unwrap();
        let mut reader = BufReader::new(local);
        assert_eq!(read_line(&mut reader, 10, deadline()).unwrap(), b"ready\n");
        assert_eq!(read_line(&mut reader, 10, deadline()).unwrap(), b"ack\n");
        peer.write_all(b"fragment").unwrap();
        assert_eq!(
            read_line(&mut reader, 10, deadline()).unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        peer.write_all(b"oversized line\n").unwrap();
        assert_eq!(
            read_line(&mut reader, 4, deadline()).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        drop(peer);
        let (local, mut peer) = UnixStream::pair().unwrap();
        nonblocking(&local).unwrap();
        peer.write_all(b"half").unwrap();
        drop(peer);
        assert_eq!(
            read_line(&mut BufReader::new(local), 10, deadline())
                .unwrap_err()
                .kind(),
            io::ErrorKind::UnexpectedEof
        );
    }
}
