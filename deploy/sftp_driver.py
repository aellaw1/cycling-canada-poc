#!/usr/bin/env python3
"""Drive an interactive sftp session via a pty, feeding the password
from an environment variable when the password prompt appears, then
running a batch of sftp commands and printing all output.
Usage: SFTP_PASS=... python3 sftp_driver.py user@host cmd1 cmd2 ...
"""
import os
import pty
import sys
import select
import time

def main():
    host_arg = sys.argv[1]
    commands = sys.argv[2:]
    password = os.environ["IONOS_FTP_PASSWORD"]

    master_fd, slave_fd = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        os.execvp("sftp", ["sftp", "-o", "StrictHostKeyChecking=no", host_arg])
        os._exit(1)

    os.close(slave_fd)
    output = b""
    password_sent = False
    commands_sent = False
    start = time.time()
    cmd_iter = iter(commands + ["bye"])

    while True:
        if time.time() - start > 60:
            break
        r, _, _ = select.select([master_fd], [], [], 2)
        if master_fd in r:
            try:
                chunk = os.read(master_fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            sys.stdout.buffer.write(chunk)
            sys.stdout.flush()
            if not password_sent and b"password:" in output.lower():
                os.write(master_fd, (password + "\n").encode())
                password_sent = True
                output = b""
            elif password_sent and not commands_sent and (b"sftp>" in output or b"sftp> " in output):
                commands_sent = True
                for c in commands:
                    os.write(master_fd, (c + "\n").encode())
                os.write(master_fd, b"bye\n")
        else:
            if password_sent and commands_sent:
                # no more output for 2s after commands sent; assume done soon
                pass

    try:
        os.kill(pid, 9)
    except ProcessLookupError:
        pass

if __name__ == "__main__":
    main()
