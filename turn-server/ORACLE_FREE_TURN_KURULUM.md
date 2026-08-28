# Hakkari Roll - Kendi Ucretsiz TURN Sunucun

Bu klasor Metered kotasindan cikmak icin Coturn kurulumunu hazirlar. Coturn ucretsiz ve acik kaynaklidir; maliyet sunucunun kendisine aittir. Oracle Always Free VM kullanirsan Always Free sinirlari icinde aylik sunucu ucreti olmaz.

## 1. Oracle VM
- Ubuntu 22.04/24.04 sec.
- Always Free eligible bir Compute shape kullan.
- Public IPv4 ata.

## 2. Oracle ag kurallari
VM'nin Security List veya NSG inbound kurallarina sunlari ekle:
- UDP 3478, source 0.0.0.0/0
- TCP 3478, source 0.0.0.0/0
- UDP 49152-65535, source 0.0.0.0/0

## 3. Scripti VM'ye koy
Bu klasordeki install_coturn.sh dosyasini VM'ye kopyala ve:

```bash
chmod +x install_coturn.sh
sudo ./install_coturn.sh
```

Script sana TURN URL, username ve password'u ekranda verir.

## 4. Railway
Metered degerlerinin yerine scriptin verdiklerini yaz:

```text
HAKKARI_ROLL_TURN_URL=turn:PUBLIC_IP:3478?transport=udp,turn:PUBLIC_IP:3478?transport=tcp
HAKKARI_ROLL_TURN_USERNAME=...
HAKKARI_ROLL_TURN_PASSWORD=...
HAKKARI_ROLL_TURN_SELF_HOSTED=true
```

Railway servisini redeploy et.

## Not
"Ucretsiz" Coturn yaziliminin lisans maliyeti olmadigi anlamina gelir. Oracle Always Free kaynaklarinin kendi kota ve kullanim kosullari vardir; tam anlamiyla sinirsiz bant genisligi garantisi degildir.
