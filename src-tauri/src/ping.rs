use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

fn write_varint(mut value: i32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(5);
    let mut uval = value as u32;
    loop {
        if (uval & !0x7F) == 0 {
            buf.push(uval as u8);
            break;
        }
        buf.push(((uval & 0x7F) | 0x80) as u8);
        uval >>= 7;
        value = uval as i32;
        let _ = value;
    }
    buf
}

async fn read_varint(stream: &mut TcpStream) -> Result<i32, String> {
    let mut num_read = 0;
    let mut result = 0i32;
    loop {
        let byte = stream.read_u8().await.map_err(|e| e.to_string())?;
        let value = (byte & 0x7F) as i32;
        result |= value << (7 * num_read);
        num_read += 1;
        if num_read > 5 {
            return Err("VarInt too big".to_string());
        }
        if (byte & 0x80) == 0 {
            break;
        }
    }
    Ok(result)
}

fn clean_motd(desc: &Value) -> String {
    if let Some(s) = desc.as_str() {
        return strip_mc_codes(s);
    }
    if let Some(obj) = desc.as_object() {
        let mut text = obj
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(extra) = obj.get("extra").and_then(|v| v.as_array()) {
            for item in extra {
                if let Some(s) = item.as_str() {
                    text.push_str(s);
                } else if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                    text.push_str(t);
                }
            }
        }
        return strip_mc_codes(&text);
    }
    "MYCHAL SMP".to_string()
}

fn strip_mc_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '§' {
            let _ = chars.next();
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

async fn direct_slp_ping(host: &str, port: u16) -> Result<Value, String> {
    let start = Instant::now();
    let addr = format!("{}:{}", host, port);
    let mut stream = timeout(Duration::from_millis(3500), TcpStream::connect(&addr))
        .await
        .map_err(|_| "Timeout connecting".to_string())?
        .map_err(|e| e.to_string())?;

    let latency = start.elapsed().as_millis() as u64;

    let host_bytes = host.as_bytes();
    let mut handshake_data = Vec::new();
    handshake_data.extend_from_slice(&write_varint(0x00)); // Packet ID 0
    handshake_data.extend_from_slice(&write_varint(767)); // Protocol version
    handshake_data.extend_from_slice(&write_varint(host_bytes.len() as i32));
    handshake_data.extend_from_slice(host_bytes);
    handshake_data.extend_from_slice(&port.to_be_bytes());
    handshake_data.extend_from_slice(&write_varint(1)); // Next state: status (1)

    let mut packet = write_varint(handshake_data.len() as i32);
    packet.extend_from_slice(&handshake_data);

    // Status request packet (length 1, packet id 0x00)
    packet.push(0x01);
    packet.push(0x00);

    timeout(Duration::from_millis(2500), stream.write_all(&packet))
        .await
        .map_err(|_| "Write timeout".to_string())?
        .map_err(|e| e.to_string())?;

    let _packet_len = timeout(Duration::from_millis(3000), read_varint(&mut stream))
        .await
        .map_err(|_| "Read packet len timeout".to_string())??;
    let packet_id = timeout(Duration::from_millis(2000), read_varint(&mut stream))
        .await
        .map_err(|_| "Read packet id timeout".to_string())??;
    if packet_id != 0x00 {
        return Err("Invalid packet id".to_string());
    }
    let json_len = timeout(Duration::from_millis(2000), read_varint(&mut stream))
        .await
        .map_err(|_| "Read json len timeout".to_string())??;
    if json_len <= 0 || json_len > 1_048_576 {
        return Err("Invalid JSON length".to_string());
    }

    let mut json_buf = vec![0u8; json_len as usize];
    timeout(Duration::from_millis(3000), stream.read_exact(&mut json_buf))
        .await
        .map_err(|_| "Read json body timeout".to_string())?
        .map_err(|e| e.to_string())?;

    let parsed: Value = serde_json::from_slice(&json_buf).map_err(|e| e.to_string())?;
    let online_players = parsed
        .pointer("/players/online")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let max_players = parsed
        .pointer("/players/max")
        .and_then(|v| v.as_u64())
        .unwrap_or(100);
    let sample = parsed
        .pointer("/players/sample")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let version = parsed
        .pointer("/version/name")
        .and_then(|v| v.as_str())
        .unwrap_or("26.3");
    let motd = parsed
        .get("description")
        .map(clean_motd)
        .unwrap_or_else(|| "MYCHAL SMP".to_string());

    Ok(json!({
        "online": true,
        "players": {
            "online": online_players,
            "max": max_players,
            "sample": sample
        },
        "version": version,
        "motd": motd,
        "latency": latency
    }))
}

async fn http_fallback_ping(host: &str) -> Result<Value, String> {
    let url = format!("https://api.mcstatus.io/v2/status/java/{}", host);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(4000))
        .user_agent("MychalSMP-Launcher/1.4.6")
        .build()
        .map_err(|e| e.to_string())?;

    let start = Instant::now();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let latency = start.elapsed().as_millis() as u64;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;

    let is_online = data.get("online").and_then(|v| v.as_bool()).unwrap_or(false);
    if !is_online {
        return Err("Server reported offline".to_string());
    }

    let online_players = data
        .pointer("/players/online")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let max_players = data
        .pointer("/players/max")
        .and_then(|v| v.as_u64())
        .unwrap_or(100);
    let version = data
        .pointer("/version/name_clean")
        .and_then(|v| v.as_str())
        .unwrap_or("26.3");
    let motd = data
        .pointer("/motd/clean")
        .and_then(|v| v.as_str())
        .unwrap_or("MYCHAL SMP");

    Ok(json!({
        "online": true,
        "players": {
            "online": online_players,
            "max": max_players,
            "sample": []
        },
        "version": version,
        "motd": motd,
        "latency": latency
    }))
}

pub async fn ping_minecraft_server(host: &str, port: u16) -> Value {
    let host = if host.trim().is_empty() {
        "mychalsmp.xyz"
    } else {
        host.trim()
    };
    let port = if port == 0 { 25565 } else { port };

    if let Ok(res) = direct_slp_ping(host, port).await {
        return res;
    }
    if let Ok(res) = http_fallback_ping(host).await {
        return res;
    }
    if host == "mychalsmp.xyz" {
        if let Ok(res) = direct_slp_ping("130.61.89.37", 25565).await {
            return res;
        }
    }

    json!({
        "online": false,
        "players": {
            "online": 0,
            "max": 0,
            "sample": []
        },
        "version": "Offline",
        "motd": "Server je momentálně nedostupný",
        "latency": 0
    })
}

