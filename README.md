# USTASANTIYE PayTR entegrasyonu

## Kurulum

1. Node.js 18 veya daha yeni bir surum kurulu olmali.
2. `npm install` komutunu calistirin.
3. `.env.example` dosyasini `.env` olarak kopyalayin.
4. PayTR magaza panelinden `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY` ve `PAYTR_MERCHANT_SALT` degerlerini girin.
5. Test icin `PAYTR_TEST_MODE=1`, canli tahsilat icin PayTR hesabiniz aktif olduktan sonra `PAYTR_TEST_MODE=0` kullanin.
6. `npm start` ile sunucuyu baslatin ve `http://localhost:3000` adresini acin.

## Google ile giris ve kayit

Google Cloud Console'da OAuth 2.0 Web application istemcisi olusturun. Authorized redirect URI olarak `http://localhost:3000/api/auth/google/callback` ekleyin ve `.env` dosyasina su degerleri yazin:

```env
GOOGLE_CLIENT_ID=Google istemci kimligi
GOOGLE_CLIENT_SECRET=Google istemci sirri
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

Google ile giris yapan yeni kullanicilar otomatik olarak hesap olusturur ve profilini tamamlamaya yonlendirilir. Sag ustteki `Oturumu kapat` dugmesi oturumu sonlandirir ve giris ekranini acar.

## Kullanici oturumu ve mesajlasma

Kullanici hesaplari ve mesajlar proje klasorundeki `data.json` dosyasinda saklanir. Bu dosya `.gitignore` icindedir ve sunucu yeniden baslatildiginda veriler korunur. Kayit dogrulamasi sonrasinda kullanici oturumu cookie ile acilir. Gercek mesajlasma icin kullanici giris yapmali; ilan sahibi kendi hesabiyla ilan olusturdugunda ilan kartindaki `Iletisime gec` dugmesi iki kullanici arasinda kalici mesajlasma saglar.

Yerel gelistirme ortaminda SMTP ayari yoksa dogrulama kodu ekranda gosterilir. Gercek e-posta gonderimi icin asagidaki SMTP degiskenlerini `.env` dosyasina ekleyin.

## Sifre yenileme e-posta ayarlari

Giris ekranindaki `Sifremi unuttum` akisi, kullanicinin kayitli e-posta adresine 6 haneli kod gonderir. Bunun icin `.env` dosyasinda `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` ve istege bagli `SMTP_FROM` degerlerini doldurun.

## Canliya alma

Node.js 18+ destekleyen bir hosting servisine projeyi yukleyin ve baslatma komutu olarak `npm start` kullanin. Hosting servisinden verilen public HTTPS adresini `.env` icindeki `BASE_URL` ve `GOOGLE_REDIRECT_URI` degerlerine yazin. Google Cloud Console'da ayni callback adresini Authorized redirect URIs listesine ekleyin.

Yayin oncesi kullanici verilerini temizleyip admin hesabini korumak icin sunucuyu durdurduktan sonra su komutu calistirin:

```bash
npm run reset:production
```

Alan adiniz hosting servisine baglandiktan sonra `www.ustasantiye.com` icin `BASE_URL` ve `GOOGLE_REDIRECT_URI` degerlerini su sekilde ayarlayin:

```env
BASE_URL=https://www.ustasantiye.com
GOOGLE_REDIRECT_URI=https://www.ustasantiye.com/api/auth/google/callback
```

Kategori ve toplam ilan sayilari `data.json` icindeki gercek ilanlardan otomatik hesaplanir.

## Kayit e-posta ayarlari

Kayit sirasinda gonderilen 6 haneli dogrulama kodu icin `.env` dosyasina `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` ve istege bagli `SMTP_FROM` degerlerini ekleyin. Gercek SMTP ayari yoksa sistem kaydi tamamlamaz ve e-posta gonderiminin yapilandirilmasi gerektigini bildirir.

## PayTR panel ayarlari

Bildirim URL'sini `https://alan-adiniz.com/api/paytr/callback` olarak tanimlayin. Gercek 3D Secure ve SMS adimi PayTR iframe'i icinde banka tarafindan yonetilir. Bildirim URL'si herkese acik HTTPS adresi olmalidir; localhost PayTR callback icin kullanilamaz.

`merchant_ok_url` ve `merchant_fail_url` musteri yonlendirme sayfalaridir. Siparisi kesinlestirme veya iptal etme karari `/api/paytr/callback` bildirimi dogrulandiktan sonra sunucu tarafinda verilmelidir.
