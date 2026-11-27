import * as XLSX from 'xlsx';
import { saveWorkbook } from '../core/download';

/**
 * Template of the Ritm store file: the same headers as the real file (they are recognised by
 * autoDetectMapping without manual mapping), a few example rows and a sheet that explains every column
 * in Azerbaijani and Russian. The two «Format» columns are on purpose: the first is the shop format,
 * the second the segment (the real file has it so; columns are told apart by their position).
 */
const HEADERS = [
  'Müştəri kodu', 'Müştəri adı', 'PAP', 'ALT', 'Format', 'RG', 'Format',
  'Enlem', 'Boylam', 'H/H', 'H/C', 'H/S', 'İş vaxtı', 'Partiyanın çatdırılma vaxtı',
];

const EXAMPLES: (string | number)[][] = [
  ['AA01', 'Nümunə Supermarket 1', '16--00 Part 1', 'NIZAMI-XETAI', 'Supermarket', '135', 'ARAZ', 40.3865, 49.8902, 42.5, 16800, 1900, '07:00 - 23:00', '08:00 - 12:00'],
  ['AA02', 'Nümunə Express 2', '16--00 Part 2', 'YASAMAL-ECEMI', 'Express', '246', 'Urban', 40.3921, 49.8104, 18.2, 7100, 820, '08:00 - 23:00', '08:00 - 16:00'],
  ['AA03', 'Nümunə Minimarket 3', '12--30 Part 1', 'NERIMANOV-AZADLIQ', 'Minimarket', '14', 'ARAZ', 40.4105, 49.8721, 9.6, 3700, 430, '7/24', '16:00 - 23:00'],
  ['AA04', 'Nümunə Franchise 4', '12--30 Part 2', 'XIRDALAN-MASAZI', 'Franchise', '1234', 'Franchise', 40.4498, 49.7602, 25, 9800, 1100, '', '16:00 - 02:00'],
  ['AA05', 'Nümunə Superstore 5', '15--00 Part 1', 'SUMQAYIT', 'Superstore', '123456', 'ARAZ', 40.5891, 49.6683, 61.3, 24500, 2700, '07:00 - 02:00', '00:00 - 08:00'],
];

const NOTES: string[][] = [
  ['Sütun', 'Nə yazmaq lazımdır (AZ)', 'Что писать (RU)', 'Məcburi / Обязательно'],
  ['Müştəri kodu', 'Mağazanın unikal kodu', 'Уникальный код магазина', 'bəli / да'],
  ['Müştəri adı', 'Mağazanın adı', 'Название магазина', 'bəli / да'],
  ['PAP', 'Partiya: qaydalardakı «Partiyalar» vərəqindəki adla eyni (məs. 16--00 Part 1)', 'Партия: как в листе «Партии» правил (например 16--00 Part 1)', 'bəli / да'],
  ['ALT', 'Region', 'Регион', 'bəli / да'],
  ['Format (birinci)', 'Mağaza formatı: Supermarket, Express, Minimarket …', 'Формат магазина: Supermarket, Express, Minimarket …', 'xeyr / нет'],
  ['RG', 'Göndərmə günləri rəqəmlərlə: 1 = B.e. … 7 = Bazar. Məs. 135 = B.e., Ç., C.', 'Дни отправки цифрами: 1 = Пн … 7 = Вс. Например 135 = Пн, Ср, Пт', 'bəli / да'],
  ['Format (ikinci)', 'Seqment: ARAZ, Urban, Franchise … (qaydalardakı «Seqmentlər» vərəqi)', 'Сегмент: ARAZ, Urban, Franchise … (лист «Сегменты» правил)', 'xeyr / нет'],
  ['Enlem, Boylam', 'Enlik və uzunluq (40.38, 49.89). Xəritə üçün', 'Широта и долгота (40.38, 49.89). Для карты', 'xeyr / нет'],
  ['H/H', 'Həftəlik həcm, m³ (və ya bir göndərmə üçün — idxal zamanı seçilir)', 'Объём за неделю, м³ (или за одну отправку — выбирается при импорте)', 'bəli / да'],
  ['H/C', 'Həftəlik çəki, kq', 'Вес за неделю, кг', 'xeyr / нет'],
  ['H/S', 'Həftəlik say, ədəd', 'Количество за неделю, шт', 'xeyr / нет'],
  ['İş vaxtı', 'Mağazanın qəbul vaxtı: «07:00 - 23:00» və ya «7/24». Boş = qaydalara görə', 'Время приёмки магазина: «07:00 - 23:00» или «7/24». Пусто = по правилам', 'xeyr / нет'],
  ['Partiyanın çatdırılma vaxtı', 'Partiyanın vaxtı: «08:00 - 16:00»', 'Окно партии: «08:00 - 16:00»', 'xeyr / нет'],
  [],
  ['Qeyd', 'Bir sətir = bir mağaza. «Nümunə» sətirlərini silib öz mağazalarınızı yazın.', 'Одна строка = один магазин. Удалите строки «Nümunə» и впишите свои магазины.', ''],
  ['Qeyd', 'Sütun adlarını dəyişməyin: o zaman proqram onları özü tanıyır.', 'Не меняйте названия колонок: тогда приложение распознает их само.', ''],
];

export function buildStoreTemplate(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...EXAMPLES]);
  ws['!cols'] = HEADERS.map((h, i) => ({ wch: i === 1 ? 24 : i === 13 ? 26 : Math.max(9, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Mağazalar');
  const notes = XLSX.utils.aoa_to_sheet(NOTES);
  notes['!cols'] = [{ wch: 26 }, { wch: 70 }, { wch: 70 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Təlimat · Инструкция');
  return wb;
}

export function downloadStoreTemplate(): void {
  saveWorkbook(buildStoreTemplate(), 'Ritm_magazalar_sablon.xlsx');
}
