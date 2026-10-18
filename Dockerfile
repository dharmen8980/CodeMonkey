# --- Final image -------------------------------------------------------------------
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    wget \
    libicu-dev \
    && rm -rf /var/lib/apt/lists/*

# Install .NET 9 SDK
RUN wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh \
    && chmod +x dotnet-install.sh \
    && ./dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
    && ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet \
    && rm dotnet-install.sh

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="${PATH}:/usr/share/dotnet"

# Install claude-cli
ARG CLAUDE_CODE_VERSION=2.1.268
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Install glab
RUN ARCH=$(dpkg --print-architecture) && \
    curl -sL "https://gitlab.com/gitlab-org/cli/-/releases/v1.52.0/downloads/glab_1.52.0_linux_${ARCH}.deb" -o glab.deb && \
    dpkg -i glab.deb && \
    rm glab.deb

WORKDIR /workspace

# Each entrypoint installs its own context/skill and removes other role assets.
COPY instructions/ /opt/orchestrator-context/instructions/
COPY context/ /context/
COPY entrypoint.sh /entrypoint.sh
COPY entrypoint-lib/ /entrypoint-lib/
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
