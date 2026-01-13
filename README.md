# ⚔️ DemonZ Core (Dz-Core)
### The Sovereign Cloud & Chat Architecture

[![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)](https://python.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Termux-black?logo=linux)]

> DemonZ Core isn’t just another backend.  
> It’s a personal, self‑hosted cloud and chat system that actually feels like it belongs to **you**.

Built by **DemonZ Development**, Dz‑Core runs on Linux servers and even on Android using Termux — no SaaS lock‑in, no tracking, no hidden magic.

---

## 🧠 What is Dz-Core?

Dz-Core is your own private digital infrastructure. It blends:

- 📁 Cloud file hosting  
- 💬 Real‑time ephemeral chat  
- 🔐 Encrypted personal vault  
- ⚙️ Smart startup automation

All controlled by a single script: `start.sh` — the brain of the whole system.

---

## 🚀 Key Features

| Feature | Description |
|------|-------------|
| 🌐 Universal Deployment | Auto‑detects Linux or Termux and configures everything automatically. |
| 📂 Hybrid Storage | Public Library for sharing + Secure Vault for encrypted private files. |
| 💬 Real‑Time Chat | Lightweight ephemeral messaging with file attachments. |
| 🏗️ Production Ready | Gunicorn support, VENV auto‑management, crash recovery & logs. |
| 🛡️ Admin Arsenal | User management, database reset, live health checks. |
| 🔑 Sovereign by Design | Your server. Your data. No outside control. |

---

## ⚡ Installation — The Magic Way™

```bash
git clone https://github.com/sdemonzdevelopment-spec/Dz-Core.git
cd Dz-Core
chmod +x start.sh
./start.sh
```

That’s literally it.

`start.sh` handles:

- Environment detection  
- Python virtual environment creation  
- Dependency installation  
- Key generation  
- Database initialization  
- Server startup

---

## 🖥️ Access

Open in your browser:

```
http://localhost:5000
```

or over LAN:

```
http://192.168.x.x:5000
```

---

## 🔒 The Sovereign Cloud Mindset

Dz‑Core is built on one belief:

> If your data isn’t on your machine, it isn’t really yours.

No external APIs.  
No telemetry.  
No vendor chains.

Just you and your infrastructure.

---

## 📜 License

Licensed under the **Apache License 2.0** — open, permissive, built for builders.
