# Ritm — göndərmə günləri və partiyalar

Ritm hər mağaza üçün həftənin hansı günlərində və hansı partiya ilə mal göndəriləcəyini planlaşdırır. Məqsəd günlər arasında yükü bərabərləşdirmək və qaydaları pozmamaqdır.

## 1. Mağazaları yükləmək

1. **Mağazaları idxal et** düyməsini basın və Excel faylını seçin. Sınaq üçün **Demonu yüklə** düyməsi var.
2. Faylın sütunlarını sahələrlə uyğunlaşdırın. Məcburi sahələr * ilə qeyd olunub: mağaza kodu, ad, partiya, region, göndərmə günləri (1–7 rəqəmləri).
3. Həcm, çəki və say sütunlarının necə verildiyini seçin: **həftəlik** və ya **bir göndərmə üçün**.
4. **Məlumatları yoxla** düyməsini basın. Proqram xətaları (məsələn, təkrarlanan kod, naməlum gün rəqəmi) və xəbərdarlıqları göstərir. Xətalı sətirlər idxal olunmur.
5. **«… mağazanı idxal et»** düyməsini basın.

## 2. Qaydalar

**Qaydalar** bölməsində qayda dəsti yaradın və ya Excel-dən idxal edin (**Boş şablonu yüklə** düyməsi ilə nümunə almaq olar). Vərəqlər:

- **Partiyalar** — partiyanın adı, göndərmə vaxtı, maşının tutumu, gündə maşın sayı, «dəyişməz» partiyalar;
- **Seqmentlər** — seqment və ya format üzrə: partiyanı necə dəyişmək olar, günlərin sayı neçə ola bilər;
- **Ümumi qaydalar** — iş günləri, «N və ya 0» qaydası (gündə qrupda ən azı N mağaza və ya heç biri), balansın prioriteti;
- **Cərimələr** və **Alqoritm** — axtarışın incə ayarları;
- **Mağaza istisnaları** — bir mağaza üçün günləri və ya partiyanı kilidləmək, icazəli və qadağan partiyalar;
- **Matris** — seqment, format və ya region üzrə əlavə icazələr və qadağalar.

**Qaydaları yoxla** düyməsi qaydaların hazır olub-olmadığını göstərir.

## 3. Optimallaşdırma

1. **Optimallaşdır** düyməsini basın.
2. Rejimi seçin: **Dəqiq** (qaydalardakı iterasiya sayı) və ya **Sürətli** (daha az iterasiya).
3. Nəticədə günlər üzrə həcmin yayılması, «N və ya 0» pozuntuları və dəyişən mağazaların sayı göstərilir. Planı qəbul edin və ya geri qaytarın (**Geri al**, Ctrl+Z).

## 4. Həftənin bölünməsi

**Həftənin bölünməsi** açarı həftəlik həcmin günlərə necə bölündüyünü göstərir:

- **Bərabər** — 20 m³ və 2 gün → 10 + 10;
- **Ritmə görə** — hər göndərmə mağazanın real istehlak ritminə görə növbəti göndərməyə qədərki günlərin həcmini aparır. Bunun üçün Proqnoz-da real sifarişləri yükləyib **Ritm-ə ötür** düyməsini basmaq lazımdır.

## 5. Bölmələr

- **Analiz** — günlər, partiyalar və regionlar üzrə yük, istilik xəritəsi, «N və ya 0» matrisi;
- **Kanban** — partiyalar üzrə sütunlar; mağazanı sürüşdürərək başqa partiyaya və ya günə keçirmək olar, kilidləmək olar;
- **Xəritə** — mağazalar xəritədə, hər gün üçün kiçik xəritələr, sahə ilə seçim;
- **Ssenarilər** — planları adla saxlayın və müqayisə edin; iş sahəsini JSON kimi ixrac və idxal edin;
- **Hesabat** — dəyişikliklərin siyahısı və maşın yükü; Excel və PDF ixracı.

## 6. Filtrlər

Yuxarıda region, partiya, seqment, format və gün üzrə filtr var. «Yalnız dəyişənlər», «Yalnız pozuntulu», «Yalnız kilidlilər» işarələri lazım olan mağazaları tez tapmağa kömək edir.

## 7. Məlumatların saxlanması

Ritm məlumatları avtomatik saxlanılır. Bulud aktivdirsə, digər cihazlarda da görünür.
