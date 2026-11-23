import { Route, Order, TruckType } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calculateRouteLegs } from './distanceHelper';
import { toLocalDateStr } from '../lib/utils';

export interface PdfExportOptions {
  routes: Route[];
  orders: Order[];
  truckTypes?: TruckType[];
  title?: string;
}

export function exportRoutesToPdf({ routes, orders, truckTypes = [], title = 'Отчет по маршрутам доставки' }: PdfExportOptions): boolean {
  if (!routes || routes.length === 0) {
    return false;
  }

  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const currentDate = new Date().toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const totalOrdersCount = routes.reduce((sum, r) => sum + r.orderIds.length, 0);
    const allAssignedOrders = orders.filter(o => routes.some(r => r.orderIds.includes(o.id)));
    const totalWeight = allAssignedOrders.reduce((sum, o) => sum + o.weight, 0);
    const totalVolume = allAssignedOrders.reduce((sum, o) => sum + o.volume, 0);
    const totalDistance = routes.reduce((sum, r) => sum + (r.distance || 0), 0);

    // Document Title
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text(title, 14, 18);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Сформировано: ${currentDate}`, 14, 24);

    // General Summary Box
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, 28, 182, 20, 2, 2, 'F');
    
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`Всего маршрутов: ${routes.length}`, 18, 35);
    doc.text(`Всего заказов: ${totalOrdersCount}`, 75, 35);
    doc.text(`Общий пробег: ${(Math.round(totalDistance * 10) / 10).toFixed(1)} км`, 130, 35);
    
    doc.text(`Общий вес: ${(Math.round(totalWeight * 10) / 10).toFixed(1)} кг`, 18, 42);
    doc.text(`Общий объем: ${(Math.round(totalVolume * 10) / 10).toFixed(1)} м³`, 75, 42);
    doc.text(`Правильный путь (OSRM): ${routes.filter(r => r.isRealRoad).length}/${routes.length}`, 130, 42);

    let startY = 53;

    // Render each route
    routes.forEach((route, routeIndex) => {
      const routeOrders = route.orderIds
        .map(id => orders.find(o => o.id === id))
        .filter((o): o is Order => Boolean(o));
      const routeWeight = routeOrders.reduce((sum, o) => sum + o.weight, 0);
      const routeVolume = routeOrders.reduce((sum, o) => sum + o.volume, 0);
      const routeSatir = routeOrders.reduce((sum, o) => sum + (o.satir || 1), 0);
      const storeCount = new Set(routeOrders.map(o => o.customerName)).size;
      const truck = truckTypes.find(t => t.id === route.truckTypeId);
      const legs = calculateRouteLegs(route, routeOrders);

      // Check if we need a new page
      if (startY > 230) {
        doc.addPage();
        startY = 18;
      }

      // Route Header
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, startY, 182, 16, 1.5, 1.5, 'FD');

      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`${routeIndex + 1}. ${route.name}`, 18, startY + 6.5);

      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      const routeInfoText = `Точек: ${storeCount} | Заказов: ${routeOrders.length} | Вес: ${(Math.round(routeWeight * 10) / 10).toFixed(1)} кг | Объём: ${(Math.round(routeVolume * 10) / 10).toFixed(1)} м³${truck ? ` | Авто: ${truck.name}` : ''}`;
      doc.text(routeInfoText, 70, startY + 6.5);

      const legsInfoText = `Пробег (Склад -> Магазины -> Склад): ${legs.totalRoundTripKm.toFixed(1)} км (Выезд: ${legs.fromWarehouseKm.toFixed(1)} км | По точкам: ${legs.betweenStoresKm.toFixed(1)} км | Возврат на склад: ${legs.toWarehouseKm.toFixed(1)} км)`;
      doc.text(legsInfoText, 18, startY + 13);

      startY += 19;

      const tableData = routeOrders.map((order, idx) => [
        (idx + 1).toString(),
        order.orderNumber || '-',
        order.customerName || 'Неизвестно',
        order.region || '-',
        (Math.round(order.weight * 10) / 10).toFixed(1),
        (Math.round(order.volume * 10) / 10).toFixed(1),
        (order.satir || 1).toString(),
        order.timeSlot || 'Любое',
        order.shippingDate || '-'
      ]);

      autoTable(doc, {
        startY: startY,
        head: [['№', 'Заказ', 'Клиент / Магазин', 'Регион', 'Вес (кг)', 'Объем (м³)', 'Строк', 'Время', 'Дата']],
        body: tableData,
        theme: 'striped',
        headStyles: {
          fillColor: [51, 65, 85],
          textColor: [255, 255, 255],
          fontSize: 7.5,
          fontStyle: 'bold',
          halign: 'left',
          cellPadding: 1.5
        },
        bodyStyles: {
          fontSize: 7,
          cellPadding: 1.5,
          textColor: [30, 41, 59]
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 16 },
          2: { cellWidth: 46 },
          3: { cellWidth: 26 },
          4: { cellWidth: 16, halign: 'right' },
          5: { cellWidth: 18, halign: 'right' },
          6: { cellWidth: 12, halign: 'center' },
          7: { cellWidth: 18 },
          8: { cellWidth: 22 }
        },
        foot: [[
          'Итого',
          `${routeOrders.length} зак.`,
          `${storeCount} точ.`,
          '-',
          (Math.round(routeWeight * 10) / 10).toFixed(1),
          (Math.round(routeVolume * 10) / 10).toFixed(1),
          routeSatir.toString(),
          '-',
          '-'
        ]],
        footStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontSize: 7.5,
          fontStyle: 'bold'
        },
        margin: { left: 14, right: 14 }
      });

      // @ts-ignore
      startY = doc.lastAutoTable.finalY + 8;
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Страница ${i} из ${pageCount} — Система оптимизации маршрутов`,
        14,
        290
      );
    }

    const filename = `Маршруты_${toLocalDateStr()}.pdf`;
    doc.save(filename);
    return true;
  } catch {
    openPrintableRoutesWindow({ routes, orders, truckTypes, title });
    return true;
  }
}

export function openPrintableRoutesWindow({ routes, orders, truckTypes = [], title = 'Отчет по маршрутам доставки' }: PdfExportOptions) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return;
  }

  const currentDate = new Date().toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  const totalOrdersCount = routes.reduce((sum, r) => sum + r.orderIds.length, 0);
  const allAssignedOrders = orders.filter(o => routes.some(r => r.orderIds.includes(o.id)));
  const totalWeight = allAssignedOrders.reduce((sum, o) => sum + o.weight, 0);
  const totalVolume = allAssignedOrders.reduce((sum, o) => sum + o.volume, 0);
  const totalDistance = routes.reduce((sum, r) => sum + (r.distance || 0), 0);

  const html = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <title>${title} - ${currentDate}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; line-height: 1.4; font-size: 11px; margin: 0; padding: 15px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; border-bottom: 2px solid #0284c7; padding-bottom: 8px; }
        .title { font-size: 18px; font-weight: bold; color: #0f172a; margin: 0; }
        .date { font-size: 10px; color: #64748b; }
        .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 11px; }
        .summary-box b { color: #0f172a; }
        .route-block { margin-bottom: 18px; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; page-break-inside: avoid; }
        .route-header { background: #f1f5f9; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #cbd5e1; }
        .route-title { font-size: 13px; font-weight: bold; color: #0f172a; display: flex; align-items: center; gap: 8px; }
        .route-color-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
        .route-meta { font-size: 10px; color: #475569; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
        th { background: #334155; color: #ffffff; font-weight: 600; text-align: left; padding: 5px 8px; border-right: 1px solid #475569; }
        th:last-child { border-right: none; }
        td { padding: 4.5px 8px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #f1f5f9; }
        td:last-child { border-right: none; }
        tr:nth-child(even) td { background: #f8fafc; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .totals-row td { background: #e2e8f0 !important; font-weight: bold; color: #0f172a; border-top: 1px solid #cbd5e1; }
        .actions { margin-bottom: 15px; display: flex; gap: 10px; }
        .btn { background: #0284c7; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 12px; }
        .btn:hover { background: #0369a1; }
        @media print {
          .actions { display: none !important; }
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="actions">
        <button class="btn" onclick="window.print()">Сохранить как PDF / Печать</button>
      </div>

      <div class="header">
        <div>
          <h1 class="title">${title}</h1>
          <div class="date">Дата формирования: ${currentDate}</div>
        </div>
        <div style="text-align: right; font-size: 11px; color: #64748b;">
          <b>Автоматическая система маршрутизации</b>
        </div>
      </div>

      <div class="summary-box">
        <div>Всего маршрутов: <b>${routes.length}</b></div>
        <div>Всего заказов: <b>${totalOrdersCount}</b></div>
        <div>Общий пробег: <b>${(Math.round(totalDistance * 10) / 10).toFixed(1)} км</b></div>
        <div>Общий вес: <b>${(Math.round(totalWeight * 10) / 10).toFixed(1)} кг</b></div>
        <div>Общий объем: <b>${(Math.round(totalVolume * 10) / 10).toFixed(1)} м³</b></div>
        <div>Навигационный путь (OSRM): <b>${routes.filter(r => r.isRealRoad).length}/${routes.length}</b></div>
      </div>

      ${routes.map((route, rIdx) => {
        const routeOrders = route.orderIds
          .map(id => orders.find(o => o.id === id))
          .filter((o): o is Order => Boolean(o));
        const rWeight = routeOrders.reduce((sum, o) => sum + o.weight, 0);
        const rVolume = routeOrders.reduce((sum, o) => sum + o.volume, 0);
        const rSatir = routeOrders.reduce((sum, o) => sum + (o.satir || 1), 0);
        const rStores = new Set(routeOrders.map(o => o.customerName)).size;
        const truck = truckTypes.find(t => t.id === route.truckTypeId);
        const legs = calculateRouteLegs(route, routeOrders);

        return `
          <div class="route-block">
            <div class="route-header">
              <div class="route-title">
                <span class="route-color-dot" style="background-color: ${route.color || '#3b82f6'};"></span>
                <span>${rIdx + 1}. ${route.name}</span>
              </div>
              <div class="route-meta">
                Магазинов: <b>${rStores}</b> | Заказов: <b>${routeOrders.length}</b> | Вес: <b>${(Math.round(rWeight * 10) / 10).toFixed(1)} кг</b> | Объём: <b>${(Math.round(rVolume * 10) / 10).toFixed(1)} м³</b> | Склад → Магазины → Склад: <b>${legs.totalRoundTripKm.toFixed(1)} км</b> (Выезд: ${legs.fromWarehouseKm.toFixed(1)} км, По точкам: ${legs.betweenStoresKm.toFixed(1)} км, Возврат: ${legs.toWarehouseKm.toFixed(1)} км)${truck ? ` | Авто: <b>${truck.name}</b>` : ''}
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 30px;" class="text-center">№</th>
                  <th style="width: 80px;">Заказ №</th>
                  <th>Клиент / Магазин</th>
                  <th style="width: 120px;">Регион</th>
                  <th style="width: 70px;" class="text-right">Вес (кг)</th>
                  <th style="width: 75px;" class="text-right">Объём (м³)</th>
                  <th style="width: 50px;" class="text-center">Sətir</th>
                  <th style="width: 80px;">Время</th>
                  <th style="width: 85px;">Дата</th>
                </tr>
              </thead>
              <tbody>
                ${routeOrders.map((order, oIdx) => `
                  <tr>
                    <td class="text-center">${oIdx + 1}</td>
                    <td><b>${order.orderNumber || '-'}</b></td>
                    <td>${order.customerName || 'Неизвестно'}</td>
                    <td>${order.region || '-'}</td>
                    <td class="text-right">${(Math.round(order.weight * 10) / 10).toFixed(1)}</td>
                    <td class="text-right">${(Math.round(order.volume * 10) / 10).toFixed(1)}</td>
                    <td class="text-center">${order.satir || 1}</td>
                    <td>${order.timeSlot || 'Любое'}</td>
                    <td>${order.shippingDate || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td class="text-center">Итого</td>
                  <td>${routeOrders.length} зак.</td>
                  <td>${rStores} точ.</td>
                  <td>-</td>
                  <td class="text-right">${(Math.round(rWeight * 10) / 10).toFixed(1)}</td>
                  <td class="text-right">${(Math.round(rVolume * 10) / 10).toFixed(1)}</td>
                  <td class="text-center">${rSatir}</td>
                  <td>-</td>
                  <td>-</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
      }).join('')}
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
