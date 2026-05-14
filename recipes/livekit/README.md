# LiveKit Media Server

WebRTC SFU used by Meet for video and audio. Auto-included whenever Meet is enabled. You will not see this service in the wizard.

## Networking

LiveKit must reach browser clients **directly** on UDP 7882 (or TCP 7881 as a fallback). Caddy / Traefik does not proxy these — they bypass the ingress entirely.

### Required firewall rules on the host

```
ufw allow 443/tcp     # Caddy (HTTPS / WebSocket signaling for LiveKit)
ufw allow 7881/tcp    # LiveKit TCP fallback
ufw allow 7882/udp    # LiveKit media (UDP)
```

Port 7880 (signaling) is **not** opened on the host firewall — it's reverse-proxied through Caddy as `wss://livekit.<your-domain>/` on port 443.

### Public IP discovery

LiveKit's `use_external_ip: true` config flag uses a STUN server (default: `stun.l.google.com:19302`) on first start to discover the host's public IP. ICE candidates advertised to clients use that IP.

**Known failure modes** (calls won't connect):
- Symmetric NAT (rare for VPS, common for home networks behind ISP CGNAT).
- Outbound STUN blocked at the host firewall.

If you hit either, the workaround is to set `LIVEKIT_NODE_IP` explicitly to your server's public IP. We don't surface this in the wizard because it's not a constraint for the cloud-VPS audience — but you can edit `output/docker/docker-compose.yml` (or the k8s deployment) by hand and add `LIVEKIT_NODE_IP=<your-ip>` to LiveKit's environment, then re-run the deploy.

## Single-node only

This bundle assumes single-node deployment. Multi-node LiveKit needs a different topology (NodePort or LoadBalancer-with-UDP) and Redis-backed clustering — out of scope for the MVP.

## Security

- The API secret is generated once into `services/livekit/.env` (Docker) or the `livekit-env` Kubernetes Secret. Meet's backend signs JWTs with the same secret.
- LiveKit's API itself is exposed only via Caddy at `wss://livekit.<your-domain>/`. Caddy terminates TLS.
- Redis is shared with Meet's backend (no AUTH on the in-cluster network). See `repository/redis/README.md`.
