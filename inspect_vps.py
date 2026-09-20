import paramiko

HOST = "178.16.136.125"
PORT = 65002
USER = "u139868009"
PASSWORD = "NnE85.J?w&LXcqM8"

def inspect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)

    commands = [
        "ls -la domains/asifzone.com",
        "ls -la domains/asifzone.com/public_html"
    ]

    for cmd in commands:
        print(f"--- Running: {cmd} ---")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print(stdout.read().decode().strip())
        print()

    ssh.close()

if __name__ == "__main__":
    inspect()


