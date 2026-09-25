import paramiko
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

HOST = "178.16.136.125"
PORT = 65002
USER = "u139868009"
# Never commit the password: set it in the shell before running, e.g.
#   VPS_SSH_PASSWORD=... python deploy_vps.py
PASSWORD = os.environ.get("VPS_SSH_PASSWORD") or sys.exit("Set VPS_SSH_PASSWORD first")
REPO_URL = "https://github.com/Tanvir660230/asifzone.git"
INSTALL_DIR = "/home/u139868009/domains/asifzone.com/public_html"

def run_cmd(ssh, command, description):
    print(f"\n[+] {description}...")
    stdin, stdout, stderr = ssh.exec_command(command)
    
    while True:
        line = stdout.readline()
        if not line:
            break
        print(line.strip())
        
    err = stderr.read().decode('utf-8', errors='replace').strip()
    exit_status = stdout.channel.recv_exit_status()
    
    if exit_status != 0:
        print(f"[-] Error during {description}: {err}")
        raise Exception(f"Command failed with exit status {exit_status}: {err}")
    else:
        print(f"[OK] Success: {description}")

def deploy():
    print(f"Connecting to {HOST}:{PORT} as {USER} with password...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=20)
    print("Connected successfully!")

    try:
        run_cmd(ssh, f"""
            cd {INSTALL_DIR};
            git remote set-url origin {REPO_URL};
            git remote -v;
            git fetch origin main;
            git reset --hard origin/main;
            git log -n 1;
        """, "Fixing git remote URL and syncing with GitHub main branch")

        run_cmd(ssh, f"""
            export PATH=/opt/alt/alt-nodejs20/root/usr/bin:$PATH;
            cd {INSTALL_DIR};
            mkdir -p ~/.npm-global;
            npm config set prefix '~/.npm-global';
            export PATH=~/.npm-global/bin:$PATH;
            npm install -g pnpm || true;
            export PATH=~/.npm-global/bin:~/.npm-global/lib/node_modules/pnpm/bin:$PATH;
            pnpm --version || npx pnpm --version;
            pnpm install;
            pnpm build;
        """, "Setting up local pnpm, installing dependencies, and building project on VPS")

        print(f"\n========================================")
        print(f" UPDATES DEPLOYED & BUILT SUCCESSFULLY! ")
        print(f"========================================")

    finally:
        ssh.close()

if __name__ == "__main__":
    deploy()

















