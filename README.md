# Metanol Gaz Dedektörü — Uzaktan İzleme Sistemi

Karf&Scoot **GDSFX** katalitik metanol gaz dedektörünü (0-100 %LEL, ATEX/IECEx),
**Four-Faith F3X26Q** LTE router üzerinden (Pure TCP modu) uzaktan izleyen Node.js uygulaması.

> ⚠️ **Güvenlik:** Bu sistem **ikincil izleme katmanıdır**. Birincil emniyet
> fonksiyonu (siren/havalandırma) dedektörün lokal röle çıkışlarındadır ve bu
> yazılımdan bağımsızdır. Yazılım hiçbir durumda sahadaki emniyet zincirinin
> yerine geçmez.

## Mimari

```
GDSFX Dedektör ──RS485──> F3X26Q Router (Pure TCP client, LTE)
                                 │  (ham baytlar şeffaf tünel)
                                 ▼
                Railway TCP Proxy ──> Node.js uygulaması
                                       ├── TCP server (Modbus RTU master) → PORT_TCP
                                       └── HTTP server (dashboard + API)  → PORT
```

Router ham Modbus RTU baytlarını TCP üzerinden tüneller (protokol dönüşümü yapmaz).
Uygulama **Modbus RTU over TCP** konuşur: MBAP header **yok**, CRC16 **var**.

## Çalıştırma (lokal)

```bash
npm install
cp .env.example .env   # değerleri düzenleyin (lokal test için PORT/PORT_TCP)
npm start
```

Dashboard: `http://localhost:3000` — API: `http://localhost:3000/api/status`

### Simülatör ile uçtan uca test

Gerçek donanım olmadan, dedektör+router çiftini taklit eden simülatör:

```bash
# Server'ı ayrı terminalde başlatın (npm start), sonra:
npm run simulate -- rising      # değer yükselir, GAS_LOW/GAS_HIGH tetikler
npm run simulate -- normal      # normal dalgalanma
npm run simulate -- fault       # sensör fault biti (SENSOR_FAULT)
npm run simulate -- timeout     # cevap vermez (COMM_LOSS)
npm run simulate -- disconnect  # bağlan-kopar-yeniden bağlan
```

Port farklıysa: `npm run simulate -- rising --port 5030 --slave 1`

### Birim testleri

```bash
npm test    # CRC16 vektörleri + frame parser (kısmi paket, bitişik çerçeve, bozuk CRC)
```

## Modbus register haritası

> ⚠️ **DİKKAT:** `registers.js` içindeki adresler **PLACEHOLDER**'dır. Gerçek
> GDSFX register haritası Karf&Scoot'tan gelince **yalnızca `registers.js`**
> güncellenecek; kodun geri kalanı değişmez.

```js
// registers.js
module.exports = {
  concentration: { addr: 0x0000, fc: 3, type: 'uint16', scale: 0.1, unit: '%LEL' },
  status:        { addr: 0x0002, fc: 3, type: 'uint16' },
  statusBits:    { faultMask: 0x0001 },  // fault biti
};
```

Ayrıca sahada **baudrate/parity** ayarının dedektör menüsü ile router'da eşit olması gerekir.

## Alarmlar

| Alarm | Koşul |
|---|---|
| `GAS_HIGH` | konsantrasyon ≥ `ALARM_HIGH_LEL` (varsayılan 20 %LEL) |
| `GAS_LOW` | konsantrasyon ≥ `ALARM_LOW_LEL` (varsayılan 10 %LEL) — ön alarm |
| `SENSOR_FAULT` | status register fault biti (katalitik sensör zehirlenmesi kritik) |
| `COMM_LOSS` | 3 ardışık Modbus timeout |
| `LINK_DOWN` | TCP bağlantısı yok **veya** son veri > `DATA_STALE_S` |

Durum makinesi: `NORMAL → ACTIVE → CLEARED`. ACTIVE'e geçişte ve CLEARED'a dönüşte
birer bildirim; ACTIVE sürerken `ALARM_REPEAT_MIN` dakikada bir hatırlatma. Tüm
geçişler DB'ye loglanır.

Bildirim katmanı soyuttur (`src/notifier.js`); başlangıçta Telegram + konsol.
E-posta/SMS ileride aynı arayüzle eklenebilir.

## API

| Endpoint | Açıklama |
|---|---|
| `GET /api/status` | anlık durum (konsantrasyon, bağlantı, aktif alarmlar) |
| `GET /api/readings?from=&to=` | geçmiş veriler (epoch ms; varsayılan son 24s) |
| `GET /api/alarms?limit=` | alarm geçmişi |
| `GET /health` | Railway healthcheck (auth'suz) |

`DASHBOARD_PASSWORD` tanımlıysa `/health` hariç tüm yollar HTTP Basic Auth ister
(kullanıcı adı boş bırakılabilir, parola = `DASHBOARD_PASSWORD`).

## Ortam değişkenleri

Tümü `.env.example` içinde. Öne çıkanlar: `PORT`, `PORT_TCP`, `MODBUS_SLAVE_ID`,
`POLL_INTERVAL_MS`, `ALARM_LOW_LEL`, `ALARM_HIGH_LEL`, `DATA_STALE_S`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_PASSWORD`, `DB_PATH`.

## Railway deployment

1. Repo'yu Railway'e bağlayın (Dockerfile otomatik algılanır).
2. **Volume** ekleyin, mount yolu `/data` (SQLite için).
3. Ortam değişkenlerini girin (en azından `DASHBOARD_PASSWORD`, Telegram bilgileri).
4. **Networking:**
   - **HTTP domain** → uygulamanın `PORT`'una (dashboard).
   - **TCP Proxy** → uygulamanın `PORT_TCP` (5020) portuna. Router buraya bağlanır.
5. **Replica sayısı = 1** (TCP proxy replikalara rastgele dağıtır, state bozulur).
6. Restart policy: on failure.
7. Deploy sonrası Railway TCP Proxy `domain:port` bilgisini router'ın
   "Serial Application → Pure TCP → uzak sunucu" alanına girin.

## Veri saklama

- `readings`: değer değiştiğinde **veya** `READING_MIN_INTERVAL_S`'de bir yazılır.
- `alarms`: tüm alarm durum geçişleri.
- `events`: bağlantı kur/kopma, CRC hataları.
- `readings` için `READING_RETENTION_DAYS` (90 gün) üzeri günlük temizlenir.
- İleride PostgreSQL'e geçiş için erişim `src/db.js` içinde toplanmıştır.

## Kapsam dışı (şimdilik)

Çoklu dedektör, e-posta/SMS, kullanıcı yönetimi, PostgreSQL. Kod tek slave'e göre
ama register/slave config genişletilebilir yapıdadır.
