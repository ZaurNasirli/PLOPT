# Yol — çatdırılma marşrutları

Yol bir gün üçün sifarişləri reyslərə bölür: hansı maşın hansı mağazalara, hansı ardıcıllıqla gedəcək. Hər reys anbardan başlayır və anbarda bitir.

## 1. Sifarişləri yükləmək

1. Yuxarı paneldə **yükləmə** düyməsini (ox yuxarı) basın və Excel faylını seçin.
2. Sütunların adları tanınarsa, sifarişlər dərhal yüklənir. Tanınmazsa, uyğunlaşdırma pəncərəsi açılır: hər sahə üçün faylın sütununu seçin.
3. Nümunə fayl lazımdırsa, **Excel şablonu** düyməsini basın.

Faylın əsas sütunları:

- **номер заказа** — sifariş nömrəsi;
- **название магазина**, **код** — mağazanın adı və kodu;
- **обьем заказа**, **вес**, **sətir** — həcm (m³), çəki (kq), sətir sayı;
- **регион**, **время**, **дата отправки** — region, vaxt slotu, göndərmə tarixi;
- **широта**, **долгота** — koordinatlar. Boşdursa, mağaza sorğu kitabçasından götürülür;
- **тип грузовика** — yalnız bu maşın tipi ilə getmək olar (istəyə görə);
- **номер маршрута** — hazır reys nömrəsi; doludursa, reys fayldakı kimi qurulur (istəyə görə);
- **откуда** — mağazalar arası daşıma üçün göndərən mağazanın kodu və ya adı (istəyə görə, aşağıda baxın).

Fayldakı mağaza məlumatları sorğu kitabçası ilə üst-üstə düşməzsə, proqram hansının əsas olduğunu soruşur.

## 2. Mağazalar arası daşıma

Mal bəzən anbardan deyil, bir mağazadan başqa mağazaya aparılır. Belə sifariş **daşıma** adlanır.

- Maşın anbardan çıxır, malı **göndərən mağazadan götürür**, **alan mağazaya aparır** və anbara qayıdır.
- Götürmə və çatdırılma həmişə **eyni reysdə** olur, götürmə həmişə **əvvəl** gəlir.
- Reysdə adi sifarişlər də varsa, reys yenə anbardan başlayır və anbarda bitir. Yalnız daşımalardan ibarət reys də anbardan çıxıb anbara qayıdır.
- Bütün marşrutlaşdırıcılar bu qaydaya əməl edir: SMART, SISR, HGS, süni intellekt (AI) rejimi və siyahıdakı bütün digər alqoritmlər.

Daşımanı iki yolla əlavə etmək olar:

1. **Excel ilə.** **откуда** sütununa göndərən mağazanın kodunu və ya adını yazın. Sətirin özü alan mağazadır (həcm, çəki, tarix, slot). Sütun boşdursa, sifariş adi qaydada anbardan gedir. Göndərən mağaza nə faylda, nə sorğu kitabçasında tapılmazsa, sifariş adi çatdırılma kimi qalır və yükləmə mesajında bu mağazanın kodu göstərilir.
2. **Əllə.** Yuxarı paneldə **iki ox** düyməsini basın («Mağazalar arası daşıma əlavə et»). Göndərən və alan mağazanı seçin, həcmi, çəkini, tarixi və slotu yazın, **Daşımanı əlavə et** düyməsini basın. Sonra marşrutlaşdırmanı işə salın.

Daşımanı necə tanımaq olar:

- mağaza kartında və reysin təfərrüatında bənövşəyi nişan **«Götürmə → mağaza»** — maşın burada malı götürür;
- mavi nişan **«Daşıma ← mağaza»** — mal buraya başqa mağazadan gəlir;
- xəritədə mağaza nişanının yanında **↑ həcm** (götürmə) və **↓** (daşıma ilə gələn mal).

Maşının yükü reys boyu dəqiq hesablanır:

- maşın anbardan reysin bütün adi sifarişləri ilə çıxır;
- hər çatdırılmada yük azalır, götürmədə daşınan həcm və çəki qədər artır, daşımanın çatdırılmasında yenə azalır;
- tutum yükün cəmi ilə deyil, reys boyu **ən yüksək yük** ilə yoxlanılır.

Nümunə: maşının tutumu 10 m³, anbardan 10 m³ çıxır (A mağazasının sifarişi 1 m³ + digərləri 9 m³), A mağazasından 2 m³ götürmək lazımdır. A birinci dayanacaq ola bilməz: orada yük 10 − 1 + 2 = 11 m³ olardı. Başqa mağazaya çatdırılmadan sonra 2 m³ yerləşir.

**SISR**, **HGS** və **SMART** götürmə ilə çatdırılma arasında başqa mağazalara da girə bilər, əgər bu kilometri azaldırsa və yük hər hissədə tutuma sığırsa. Digər alqoritmlər daşımanı ehtiyatla hesablayır: daşınan yükü anbardan götürülmüş kimi sayır.

Vacib məqamlar:

- Götürmə nöqtəsinin öz həcmi və çəkisi 0-dır, daşınan yük götürmədən çatdırılmaya qədər maşında sayılır.
- Yükləmə faizi, maşının seçilməsi və reysin yoxlanması reys boyu ən yüksək yükə görə hesablanır.
- Götürmə nöqtələri «reysdə mağaza sayı» və «reysdə region sayı» limitlərinə daxil deyil. Növbənin uzunluğu isə yol və dayanma vaxtı ilə birlikdə hesablanır.
- Götürməni və ya çatdırılmanı əllə başqa reysə keçirsəniz, proqram cütü özü düzəldir: götürmə çatdırılma ilə eyni reysə, ondan əvvələ qoyulur. Çatdırılma reysdən çıxarılsa, götürmə də çıxır.

## 3. Marşrutları qurmaq

1. **Marşrutlaşdırıcı** düyməsini (yuxarıda, ayarlar nişanı) basın.
2. **Ümumi parametrlər** bölməsində limitləri yazın: maşının həcmi və çəkisi, reysdə mağaza və region sayı, reys və kilometr qiyməti, dayanma vaxtı.
3. **Nəqliyyat tipləri** bölməsində maşın tiplərini və hər tipdən neçə maşın olduğunu yazın.
4. **Alqoritmlər** bölməsində alqoritmi seçin. Yuxarıda ayrıca blokda üç **əsas marşrutlaşdırıcı** var: **SISR** (adətən ən yaxşı), **HGS** («Качество» rejimi üçün) və **SMART**. Onlar daşımaları və reys boyu yükü dəqiq hesablayır. Digər alqoritmlər aşağıdakı siyahıdadır. Rejim: «Быстрый» (sürətli), «Баланс» (balans), «Качество» (keyfiyyət).
5. **Marşrutlaşdırmanı işə sal** düyməsini basın. Nəticə pəncərəsində yürüşü, qiyməti və maşın sayını əvvəlki planla müqayisə edin, sonra **Принять оптимизацию** (qəbul et) və ya **Вернуть как было** (geri qaytar) düyməsini basın.

Əlavə məhdudiyyətlər (marşrutlaşdırıcıda):

- **Must Stay Together** — bu sifarişlər bir reysdə getməlidir;
- **Avoid Together** — bu iki sifariş bir reysdə getməməlidir;
- **kilid** — mağazanı və ya bütün reysi kilidləsəniz, yenidən hesablamada dəyişmir.

## 4. Reysləri yoxlamaq və dəyişmək

- Sol paneldə **Marşrutlar** bölməsində reysin üzərinə basın: təfərrüat pəncərəsində mağazalar sıra ilə, hər addımın kilometri, yük, qiymət və yoxlama (audit) görünür.
- Oxlarla mağazanın sırasını dəyişin, siyahıdan başqa reysə keçirin.
- Xəritədə reysin xəttinin üzərinə gətirin və ya basın: digər reyslər solğunlaşır.
- **Geri al** düyməsi son dəyişikliyi ləğv edir. **Fəaliyyət tarixçəsi** bölməsində əvvəlki vəziyyətə qayıtmaq olar.
- **Ssenarilər** — planı adla saxlayın və sonra müqayisə edin.

## 5. Xəritə alətləri

- **Maneələr (bağlı yollar)** — nöqtə, küçə və ya zona kimi bağlı yol əlavə edin. Marşrutlaşdırıcı onu dolanır.
- **Küçələr** — küçələri rənglə işarələyin və onların mağazalarını seçin.
- **Analitika** — reyslərin yükü, yürüşü və regionları üzrə xülasə.

## 6. Nəticəni ixrac etmək

- **Экспорт маршрутов (.xlsx)** — reyslərin xülasəsi və hər dayanacaq sıra ilə. «Тип остановки» sütunu adi çatdırılmanı, daşımanın götürməsini və çatdırılmasını göstərir.
- PDF — sürücü üçün reys vərəqi; daşıma nöqtələri ayrıca qeyd olunur.

## 7. Məlumatların saxlanması

Məlumatlar avtomatik saxlanılır. Bulud aktivdirsə (yaşıl bulud nişanı), eyni linki açan hər cihaz eyni məlumatları görür.
