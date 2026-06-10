import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { AgentRuntime } from "@/lib/types/agent-runtime";

export type MachineInitInput = {
  projectName: string;
  serverType?: string;
  serverLocation?: string;
  serverImage?: string;
  runtimeAgent?: AgentRuntime;
};

export type MachineInitResult = {
  projectName: string;
  projectDir: string;
  envPath: string;
  sshAlias: string;
  serverName: string;
  commands: {
    editEnv: string;
    listServerTypes: string;
    listLocations: string;
    provision: string;
    verify: string;
    bootstrap: string;
    destroy: string;
  };
};

function slugifyProjectName(input: string) {
  const slug = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "agent-machine";
}

function shellSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function initializeHetznerControlRoomMachine(input: MachineInitInput): Promise<MachineInitResult> {
  const projectName = slugifyProjectName(input.projectName);
  const serverName = `${projectName}-agent`;
  const sshAlias = projectName;
  const projectDir = join(homedir(), ".hivemindos", "machines", projectName);
  const scriptsDir = join(projectDir, "scripts");
  const sshKeyFile = join(projectDir, "keys", projectName);
  const sshKeyName = `${projectName}-key`;

  await mkdir(scriptsDir, { recursive: true });
  await mkdir(join(projectDir, "keys"), { recursive: true });

  await Promise.all([
    writeFile(join(projectDir, ".gitignore"), GITIGNORE_TEMPLATE, "utf-8"),
    writeFile(join(projectDir, ".env"), envTemplate({
      serverName,
      serverType: input.serverType?.trim() || "cx23",
      serverImage: input.serverImage?.trim() || "ubuntu-24.04",
      serverLocation: input.serverLocation?.trim() || "hel1",
      sshKeyName,
      sshKeyFile,
      sshAlias,
      runtimeAgent: input.runtimeAgent || "hermes",
    }), { encoding: "utf-8", mode: 0o600 }),
    writeFile(join(scriptsDir, "provision.sh"), PROVISION_SCRIPT, { encoding: "utf-8", mode: 0o755 }),
    writeFile(join(scriptsDir, "destroy.sh"), DESTROY_SCRIPT, { encoding: "utf-8", mode: 0o755 }),
    writeFile(join(scriptsDir, "bootstrap-hivemindos.sh"), BOOTSTRAP_HIVEMINDOS_SCRIPT, { encoding: "utf-8", mode: 0o755 }),
  ]);

  const quotedDir = shellSingleQuote(projectDir);
  return {
    projectName,
    projectDir,
    envPath: join(projectDir, ".env"),
    sshAlias,
    serverName,
    commands: {
      editEnv: `open -a TextEdit ${shellSingleQuote(join(projectDir, ".env"))}`,
      listServerTypes: `cd ${quotedDir} && set -a && . ./.env && set +a && hcloud server-type list`,
      listLocations: `cd ${quotedDir} && set -a && . ./.env && set +a && hcloud location list`,
      provision: `cd ${quotedDir} && ./scripts/provision.sh`,
      verify: `ssh ${sshAlias} 'echo connected as $(whoami) on $(hostname); uname -a'`,
      bootstrap: `cd ${quotedDir} && ./scripts/bootstrap-hivemindos.sh`,
      destroy: `cd ${quotedDir} && ./scripts/destroy.sh`,
    },
  };
}

function envTemplate(values: {
  serverName: string;
  serverType: string;
  serverImage: string;
  serverLocation: string;
  sshKeyName: string;
  sshKeyFile: string;
  sshAlias: string;
  runtimeAgent: AgentRuntime;
}) {
  return `# Hetzner Cloud API token.
# Create it in Hetzner Cloud Console -> Security -> API Tokens.
# Permission: Read & Write.
# NEVER commit or paste this token into chat.
# Leave blank here if you saved HCLOUD_TOKEN with hive-env-add.
HCLOUD_TOKEN=

# Populated automatically by provision.sh once the server is created.
SERVER_HOST=

# Server config.
SERVER_NAME=${values.serverName}
SERVER_TYPE=${values.serverType}
SERVER_IMAGE=${values.serverImage}
SERVER_LOCATION=${values.serverLocation}

# SSH config.
SSH_KEY_NAME=${values.sshKeyName}
SSH_KEY_FILE=${values.sshKeyFile}
SSH_ALIAS=${values.sshAlias}

# HivemindOS bootstrap config.
HIVE_REPO_URL=https://github.com/LiamVisionary/hivemindos.git
HIVE_APP_DIR=/opt/hivemindos
HIVE_AGENT_RUNTIME=${values.runtimeAgent}
`;
}

const GITIGNORE_TEMPLATE = `.env
*.bak
*.log
keys/
`;

// Adapted from shannhk/hermes-agent-control-room:
// skills/create-vps/assets/provision.sh
const PROVISION_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env"
  exit 1
fi

set -a
. ./.env
set +a

if [ -z "\${HCLOUD_TOKEN:-}" ] && [ -f "$HOME/.hivemindos/.env" ]; then
  set -a
  . "$HOME/.hivemindos/.env"
  set +a
fi

required_vars="HCLOUD_TOKEN SERVER_NAME SERVER_TYPE SERVER_IMAGE SERVER_LOCATION SSH_KEY_NAME SSH_KEY_FILE SSH_ALIAS"
for var in $required_vars; do
  if [ -z "\${!var:-}" ]; then
    echo "Missing $var in .env"
    exit 1
  fi
done

if ! command -v hcloud >/dev/null 2>&1; then
  echo "Missing hcloud CLI. Install it first, then rerun this script."
  exit 1
fi

mkdir -p "$(dirname "$SSH_KEY_FILE")"

if [ ! -f "$SSH_KEY_FILE" ]; then
  ssh-keygen -t ed25519 -f "$SSH_KEY_FILE" -N "" -C "$SSH_KEY_NAME"
fi

if ! hcloud ssh-key describe "$SSH_KEY_NAME" >/dev/null 2>&1; then
  hcloud ssh-key create --name "$SSH_KEY_NAME" --public-key-from-file "$SSH_KEY_FILE.pub"
fi

if ! hcloud server describe "$SERVER_NAME" >/dev/null 2>&1; then
  hcloud server create \\
    --name "$SERVER_NAME" \\
    --type "$SERVER_TYPE" \\
    --image "$SERVER_IMAGE" \\
    --location "$SERVER_LOCATION" \\
    --ssh-key "$SSH_KEY_NAME"
fi

SERVER_HOST="$(hcloud server ip "$SERVER_NAME")"

if grep -q '^SERVER_HOST=' .env; then
  sed -i.bak "s|^SERVER_HOST=.*|SERVER_HOST=$SERVER_HOST|" .env
else
  printf '\\nSERVER_HOST=%s\\n' "$SERVER_HOST" >> .env
fi
rm -f .env.bak

mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/config"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/config"

TMP_CONFIG="$(mktemp)"
awk -v alias="$SSH_ALIAS" '
  BEGIN { skip=0 }
  /^Host / {
    if ($2 == alias) { skip=1; next }
    skip=0
  }
  skip == 0 { print }
' "$HOME/.ssh/config" > "$TMP_CONFIG"

cat >> "$TMP_CONFIG" <<EOF

Host $SSH_ALIAS
    HostName $SERVER_HOST
    User root
    IdentityFile $SSH_KEY_FILE
    Port 22
EOF

mv "$TMP_CONFIG" "$HOME/.ssh/config"
chmod 600 "$HOME/.ssh/config"

echo "Done. Connect with: ssh $SSH_ALIAS"
`;

// Adapted from shannhk/hermes-agent-control-room:
// skills/create-vps/assets/destroy.sh
const DESTROY_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env"
  exit 1
fi

set -a
. ./.env
set +a

if [ -z "\${HCLOUD_TOKEN:-}" ] && [ -f "$HOME/.hivemindos/.env" ]; then
  set -a
  . "$HOME/.hivemindos/.env"
  set +a
fi

if [ -z "\${HCLOUD_TOKEN:-}" ] || [ -z "\${SERVER_NAME:-}" ]; then
  echo "Missing HCLOUD_TOKEN or SERVER_NAME"
  exit 1
fi

echo "This will delete Hetzner server: $SERVER_NAME"
read -r -p "Type DELETE to continue: " confirm

if [ "$confirm" != "DELETE" ]; then
  echo "Aborted"
  exit 1
fi

hcloud server delete "$SERVER_NAME"
`;

const BOOTSTRAP_HIVEMINDOS_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env"
  exit 1
fi

set -a
. ./.env
set +a

if [ -z "\${SSH_ALIAS:-}" ]; then
  echo "Missing SSH_ALIAS in .env"
  exit 1
fi

BOOTSTRAP_REMOTE="/tmp/bootstrap-hivemindos.sh"
cat > /tmp/hivemindos-bootstrap.sh <<'BOOTSTRAP'
#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

HIVE_REPO_URL="\${HIVE_REPO_URL:-https://github.com/LiamVisionary/hivemindos.git}"
HIVE_APP_DIR="\${HIVE_APP_DIR:-/opt/hivemindos}"
HIVE_AGENT_RUNTIME="\${HIVE_AGENT_RUNTIME:-hermes}"

log() {
  printf '\\n==> %s\\n' "$*"
}

log "Installing base packages"
apt-get update -qq
apt-get install -y --no-install-recommends curl ca-certificates git tmux htop

log "Installing Node.js 22 if needed"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v\\([0-9][0-9]*\\).*/\\1/')"
fi

if [ "$NODE_MAJOR" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

log "Preparing pnpm"
if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@8.6.12 --activate || corepack prepare pnpm@latest --activate
fi

log "Preparing selected runtime: $HIVE_AGENT_RUNTIME"
case "$HIVE_AGENT_RUNTIME" in
  hermes)
    if ! command -v hermes >/dev/null 2>&1 && [ ! -d /usr/local/lib/hermes-agent ] && [ ! -d "$HOME/.hermes/hermes-agent" ]; then
      curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash || true
    fi
    ;;
  openclaw|aeon|hivemind-os)
    log "$HIVE_AGENT_RUNTIME selected; HivemindOS fleet wiring and shared skill targets will be installed."
    ;;
  *)
    log "Unknown runtime '$HIVE_AGENT_RUNTIME'; continuing with HivemindOS fleet wiring."
    ;;
esac

log "Cloning or updating HivemindOS"
mkdir -p "$(dirname "$HIVE_APP_DIR")"
if [ ! -d "$HIVE_APP_DIR/.git" ]; then
  git clone "$HIVE_REPO_URL" "$HIVE_APP_DIR"
else
  git -C "$HIVE_APP_DIR" pull --ff-only
fi

log "Running HivemindOS setup"
cd "$HIVE_APP_DIR"
HIVE_SETUP_INTERACTIVE=false HIVE_SHARED_SKILLS=true HIVE_SHARED_SKILL_TARGETS="$HIVE_AGENT_RUNTIME" ./setup.sh --non-interactive

log "Ensuring fleet collector is installed"
# Provisioned VPS workers register ephemeral tailnet nodes so destroyed or
# re-provisioned servers never leave stale device registrations behind.
AGENT_TELEMETRY_HERMES_RESTART=now HIVE_LINK_EPHEMERAL="\${HIVE_LINK_EPHEMERAL:-true}" ./scripts/install-telemetry-collector.sh

if command -v hermes >/dev/null 2>&1 && [ "$HIVE_AGENT_RUNTIME" = "hermes" ]; then
  hermes config set API_SERVER_ENABLED true >/dev/null || true
  hermes config set API_SERVER_HOST 127.0.0.1 >/dev/null || true
  hermes config set API_SERVER_PORT 8642 >/dev/null || true
fi

log "Installed versions"
printf 'node:   %s\\n' "$(node --version 2>&1 || true)"
printf 'npm:    %s\\n' "$(npm --version 2>&1 || true)"
printf 'pnpm:   %s\\n' "$(pnpm --version 2>&1 || true)"
printf 'hermes: %s\\n' "$(command -v hermes >/dev/null 2>&1 && hermes --version 2>&1 || echo 'install may need interactive completion')"
printf 'repo:   %s\\n' "$(git -C "$HIVE_APP_DIR" remote get-url origin 2>&1 || true)"
printf 'app:    %s\\n' "$HIVE_APP_DIR"
BOOTSTRAP

chmod +x /tmp/hivemindos-bootstrap.sh
scp /tmp/hivemindos-bootstrap.sh "$SSH_ALIAS:$BOOTSTRAP_REMOTE"
ssh "$SSH_ALIAS" "HIVE_REPO_URL='\${HIVE_REPO_URL:-https://github.com/LiamVisionary/hivemindos.git}' HIVE_APP_DIR='\${HIVE_APP_DIR:-/opt/hivemindos}' HIVE_AGENT_RUNTIME='\${HIVE_AGENT_RUNTIME:-hermes}' $BOOTSTRAP_REMOTE" 2>&1 | tee bootstrap-hivemindos.log

echo
echo "Next steps:"
echo "  ssh $SSH_ALIAS"
echo "  cd \${HIVE_APP_DIR:-/opt/hivemindos}"
echo "  ./scripts/install-telemetry-collector.sh"
echo "  hermes auth   # if Hermes was selected and needs interactive auth"
`;
