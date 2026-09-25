import paramiko
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

HOST = "178.16.136.125"
PORT = 65002
USER = "u139868009"
# Never commit the password: set it in the shell before running, e.g.
#   VPS_SSH_PASSWORD=... python inspect_vps.py
PASSWORD = os.environ.get("VPS_SSH_PASSWORD") or sys.exit("Set VPS_SSH_PASSWORD first")

def inspect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)

    commands = [
        "ls -la domains/asifzone.com",
        "ls -la domains"
    ]

    for cmd in commands:
        print(f"--- Running: {cmd} ---")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='replace').strip()
        print(out)
        err = stderr.read().decode('utf-8', errors='replace').strip()
        if err:
            print(f"STDERR: {err}")
        print()

    ssh.close()

if __name__ == "__main__":
    inspect()










