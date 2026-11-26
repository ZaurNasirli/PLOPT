# Proqnoz — növbəti həftənin sifariş proqnozu

Proqnoz real sifarişlərə görə növbəti həftədə hər mağazanın nə qədər sifariş edəcəyini hesablayır: m³, kq və ya ədəd.

## 1. Sifarişləri yükləmək

1. **Sifarişləri yüklə** düyməsini basın və 2–4 həftəlik real sifarişlərin Excel faylını seçin. Sınaq üçün **Demo** düyməsi var.
2. Bir sətir — mağazanın bir tarixdəki sifarişidir. Tarix sifariş tarixidir, maşın gecə yarısından sonra çıxsa belə.
3. Mütləq sütunlar: **sifariş tarixi**, **mağaza kodu** və ən azı bir ölçü (**m³**, **kq** və ya **ədəd**). Ad, region, format və seqment istəyə görədir.
4. **Faylın sütunları** pəncərəsində hər sütunun mənasını yoxlayın və **Hesabla** düyməsini basın.

Həftə nə qədər çox olsa, proqnoz bir o qədər dəqiq olur. Yeni mağazalar ikinci həftədən görünür.

## 2. Nəticəni oxumaq

- **Həftəlik proqnoz** — bütün şəbəkə üzrə cəmi və 80% aralıq (həftə 80% ehtimalla bu aralığa düşür);
- **Həftədə sifariş** — gözlənilən sifariş sayı;
- **İşləyən mağazalar**, **Yeni mağazalar**, **Bağlananlar**;
- **Proqnozun dəqiqliyi** — metod keçmiş həftələrdə yoxlanılır və ən yaxşısı seçilir (çəkili orta, orta, median, son həftə, trend);
- **Həftələr üzrə** — fakt və proqnoz;
- **Növbəti həftə günlər üzrə** — **Bərabər** və ya **Real ritmə görə** bölünmə;
- **Şəbəkənin istehlak ritmi** — mağazaların hər gün xərclədiyi həftə payı;
- **Açılışlar və bağlanmalar** — yeni açılan və uzun müddət sifariş verməyən mağazalar.

## 3. Mağazalar cədvəli

Cədvəldə hər mağazanın statusu (**İşləyir**, **Yeni**, **7+ gün susur**, **Bağlıdır**), sifariş günləri, proqnozu, 80% aralığı və keçən həftəyə görə dəyişməsi var. Sətirə basın: mağazanın sifarişləri və günlər üzrə proqnozu açılır.

## 4. Ayarlar

**Ayarlar** düyməsi ilə dəyişmək olar:

- mağaza neçə gün sifarişsiz qalanda **bağlı** sayılır;
- mağaza ilk neçə həftədə sifariş verməyibsə **yeni** sayılır.

Ölçü vahidi (m³, kq və ya ədəd) yuxarıdakı **Ölçü** seçimi ilə dəyişir.

## 5. Ritm-ə ötürmək

**Ritm-ə ötür** düyməsi iki şey edir:

1. Ritm-dəki həftəlik həcmləri proqnozla əvəz edir. Fayldakı həcmlər itmir: Ritm-də **Həcmləri fayldan qaytar** düyməsi ilə qaytarmaq olar.
2. Real ritmi ötürür və Ritm-də həftənin «ritmə görə» bölünməsini açır.

Sifarişlərdə olub Ritm-də olmayan mağazalar ayrıca göstərilir: onları Ritm mağaza faylına əlavə edin.

## 6. İxrac

**Excel** düyməsi proqnozu mağazalar və günlər üzrə Excel faylına yazır.
