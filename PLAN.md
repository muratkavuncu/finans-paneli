# Finans Paneli — Yol Haritası

Amaç: Piyasanın nereye gittiğini tek bakışta okutan, canlı veriyle çalışan, sade ve
eğlenceli bir web paneli. Panel önce bilgi toplar ve görselleştirir; sonra üzerine
teknik/temel analiz, strateji ve sinyal katmanı eklenir. Emirleri her zaman kullanıcı
kendisi verir; panel işlem yapmaz.

Odak: kripto (BTC, RENDER başta) ve teknoloji; gündemin etkilediği sektörler ikincil.

## Teknik yapı

- Arka uç: Python (bilgisayarda kurulu, 3.9). Veri kaynaklarını toplar, önbelleğe alır,
  panele tek bir yerden sunar.
- Ön yüz: tarayıcıda açılan tek sayfa; grafik kütüphaneleri hazır alınır.
- Canlı fiyat: borsanın herkese açık WebSocket akışı (anahtar gerekmez, saniyenin altında).
- Veri saklama: SQLite (geçmiş mumlar, haberler, sinyaller).

## Aşamalar

### Aşama 1 — Canlı piyasa paneli (ilk çalışan sürüm)
- Takip listesi: BTC, RENDER, ETH, SOL + seçilecek diğerleri; anlık fiyat, 24s değişim
- Canlı mum grafiği (zaman dilimi seçilebilir)
- Piyasa özeti: toplam piyasa değeri, BTC dominansı, Korku ve Açgözlülük endeksi
- Isı haritası ve dağılım (pie) grafikleri
- Bitti sayılır: sayfa açılır, fiyatlar kendiliğinden akar, yenilemeye gerek kalmaz

### Aşama 2 — Gündem ve haber akışı
- Kripto ve teknoloji haber kaynaklarından (RSS) canlı akış
- Haberleri enstrümanlarla eşleştirme, önem ve duygu (olumlu/olumsuz) etiketi
- Ekonomik takvim: Fed kararları, enflasyon verisi, büyük şirket bilançoları
- Bitti sayılır: önemli bir haber düştüğünde panelde ilgili varlıkla birlikte görünür

### Aşama 3 — Teknoloji hisseleri ve makro
- NVDA, MSFT, TSLA gibi teknoloji hisseleri, Nasdaq, dolar endeksi (DXY), altın
- Kripto ile hisse arasındaki korelasyon görünümü
- Not: ücretsiz hisse verisi çoğunlukla 15 dk gecikmelidir; anlık için ücretli/anahtarlı
  kaynak gerekir

### Aşama 4 — Teknik analiz katmanı
- Göstergeler: hareketli ortalamalar, RSI, MACD, Bollinger, hacim, destek/direnç
- Zincir üstü ve türev verileri: fonlama oranı, açık pozisyon, likidasyonlar
- Çoklu zaman dilimi özeti (her varlık için tek satırda trend durumu)

### Aşama 5 — Strateji ve geri test
- Kurala dayalı stratejiler tanımlama
- Geçmiş veride geri test: getiri, en büyük düşüş, kazanma oranı
- Komisyon ve kayma dahil gerçekçi sonuçlar

### Aşama 6 — Sinyal ve uyarılar
- Strateji koşulu oluşunca panelde ve bildirimle uyarı
- Sinyal günlüğü: hangi sinyal ne zaman geldi, sonrasında ne oldu
- Kağıt üstünde (sanal) işlem takibi

## Sınırlar
- Panel ve sinyaller karar destek aracıdır; yatırım tavsiyesi değildir.
- Emir gönderme, borsa hesabına bağlanma ve para transferi kapsam dışıdır.
