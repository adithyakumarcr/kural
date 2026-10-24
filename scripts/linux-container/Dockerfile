# Kural on Linux, from a Mac (or any Docker host): Ubuntu 22.04 like build.yml's .deb build, so the glibc that VS Code's
# native modules are built against is the oldest one the .deb has to run on. Used by run.sh; build it with
#   scripts/linux-container/run.sh build-image
# What is in it:
#   - the apt list of build-from-source.yml's linux job (compiler, pkg-config, the libraries VS Code's native modules use);
#   - openssh-client (ssh, ssh-keygen: the devices tests need Kural's own key and the ssh program), rsync (the repository copy), ripgrep (the search tests);
#   - Node at the version of VS Code's .nvmrc (NODE_VERSION, 24.18.0 for vscode.lock's commit; checked against nodejs.org's SHASUMS256.txt);
#   - Xvfb, openbox, xdotool, dbus-x11: a small desktop, so a window's show/hide/bounds behave like on a computer;
#   - the libraries Electron needs to start (the .deb's Depends brings them too, but the start check wants them before).
# Nothing of Kural is copied in: run.sh mounts the repository read-only.
FROM ubuntu:22.04

ARG NODE_VERSION=24.18.0
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8

RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip xz-utils sudo rsync procps openssh-client \
      build-essential pkg-config python3 python3-pil libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev \
      xvfb openbox xdotool dbus-x11 x11-utils \
      libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 libxkbfile1 libsecret-1-0 libcups2 libatk-bridge2.0-0 \
      libdrm2 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libpango-1.0-0 libcairo2 libatspi2.0-0 libnspr4 \
      fonts-dejavu-core ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Node, from nodejs.org for the architecture of this image (arm64 on an Apple Silicon Mac, x64 under --platform linux/amd64).
RUN set -eu; \
    case "$(dpkg --print-architecture)" in amd64) P=linux-x64 ;; arm64) P=linux-arm64 ;; *) echo "no Node for this architecture" >&2; exit 1 ;; esac; \
    F="node-v${NODE_VERSION}-${P}.tar.xz"; B="https://nodejs.org/dist/v${NODE_VERSION}"; \
    curl -fsSL -o "/tmp/$F" "$B/$F"; curl -fsSL -o /tmp/SHASUMS256.txt "$B/SHASUMS256.txt"; \
    (cd /tmp && grep -F "  $F" SHASUMS256.txt | sha256sum -c -); \
    tar -xJf "/tmp/$F" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "/tmp/$F" /tmp/SHASUMS256.txt; \
    node -v && npm -v

# A normal user for the live checks (Electron's sandbox and "refuses to run as root" are about root); the build runs as root.
RUN useradd -m -u 1000 -s /bin/bash kural \
    && echo 'kural ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/kural && chmod 0440 /etc/sudoers.d/kural

WORKDIR /work
CMD ["bash"]
