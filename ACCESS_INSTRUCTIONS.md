# 🎮 Hunter's Guild Server - Access Instructions

## 🌐 Website Access

### Current Status: HTTP Only (HTTPS Coming Soon)

Your friend can access the control panel using:

### **Option 1: Using Domain (Recommended)**

```
http://huntersguild.duckdns.org
```

### **Option 2: Using IP Address (If DNS doesn't work)**

```
http://197.48.158.249
```

### **Option 3: Alternative Port**

```
http://huntersguild.duckdns.org:3000
http://197.48.158.249:3000
```

---

## 🎯 Minecraft Server Connection

Connect using Minecraft Java Edition:

### **Server Address:**

```
huntersguild.duckdns.org:25565
```

or

```
197.48.158.249:25565
```

**Version Required:** Forge 1.21.11 (Build 61.0.8)

---

## ⚠️ Important Notes

1. **Use HTTP (not HTTPS)** - SSL certificate is still being configured
2. **Firewall**: Windows Firewall rules are configured ✅
3. **Router**: You MUST configure port forwarding on your router (see below)
4. **DNS**: DuckDNS is updating every 5 minutes with your IP

---

## 🔧 Router Configuration Required

**CRITICAL:** You need to add port forwarding rules in your router settings.

### Access Your Router:

1. Open browser and go to: `http://192.168.1.1` (or your router's IP)
2. Login with your router admin credentials
3. Find "Port Forwarding" or "Virtual Server" section
4. Add these rules:

| Service Name | External Port | Internal IP | Internal Port | Protocol |
| ------------ | ------------- | ----------- | ------------- | -------- |
| HTTP         | 80            | 192.168.1.3 | 80            | TCP      |
| HTTPS        | 443           | 192.168.1.3 | 443           | TCP      |
| Web Alt      | 3000          | 192.168.1.3 | 3000          | TCP      |
| Minecraft    | 25565         | 192.168.1.3 | 25565         | TCP      |

**Your Internal IP:** `192.168.1.3`

### Common Router Admin Pages:

- **TP-Link**: `192.168.0.1` or `192.168.1.1`
- **Netgear**: `192.168.1.1` or `routerlogin.net`
- **Linksys**: `192.168.1.1` or `myrouter.local`
- **ASUS**: `192.168.1.1` or `router.asus.com`

---

## ✅ Troubleshooting

### If your friend can't connect:

1. **Verify router port forwarding is configured** (most common issue)
2. **Check if your IP changed**: Visit https://www.duckdns.org/domains
3. **Test from outside**: Use your phone's mobile data (not WiFi) to test
4. **Verify services are running**:
   ```powershell
   docker-compose ps
   ```

### Check Current Public IP:

```powershell
curl ifconfig.me
```

### Check DuckDNS Status:

```powershell
nslookup huntersguild.duckdns.org
```

### Restart Services:

```powershell
docker-compose restart
```

---

## 📊 Service Status

- ✅ Minecraft Server: `Running`
- ✅ API Backend: `Running`
- ✅ Frontend: `Running`
- ✅ DuckDNS: `Running`
- ✅ Caddy (HTTP): `Running`
- ⏳ Caddy (HTTPS): `In Progress` (DNS issues)

---

## 🔐 Admin Access

**Control Panel Login:**

- Email: `3asmbeta3y@gmail.com`
- Password: `3asmbeta3y`

⚠️ **Change this password in production!**

---

## 📝 What's Working vs Not Working

### ✅ Working:

- Local access (localhost)
- Docker containers
- Windows Firewall
- DuckDNS IP updates
- HTTP configuration

### ❌ Not Working Yet:

- External access (needs router config)
- HTTPS/SSL (DNS validation failing)

### 🔧 To Fix:

1. **Configure router port forwarding** (see above)
2. Wait for DNS to stabilize (SSL will auto-fix once DNS is stable)

---

## 💡 Quick Test

**From your friend's computer**, open browser and try:

1. `http://197.48.158.249`
2. If that doesn't work → **Router port forwarding not configured**
3. If it works → Great! Also try `http://huntersguild.duckdns.org`

---

**Last Updated:** February 2, 2026
**Server IP:** 197.48.158.249
**Domain:** huntersguild.duckdns.org
