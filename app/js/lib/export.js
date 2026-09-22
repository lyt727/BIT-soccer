// 零依赖导出：生成 Excel 2003 SpreadsheetML（.xls），Excel / WPS 可直接打开
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');
}

function cell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${esc(value)}</Data></Cell>`;
}

export async function exportExcel(filename, sheetName, headers, rows) {
  const safeSheet = String(sheetName || 'Sheet1').replace(/[\\/?*[\]:]/g, '-').slice(0, 28);
  const headerXml = `<Row>${headers.map((h) => cell(h)).join('')}</Row>`;
  const bodyXml = rows.map((row) => `<Row>${row.map(cell).join('')}</Row>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="head">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E6F4EC" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${esc(safeSheet)}">
  <Table>
   ${headerXml.replace(/<Cell>/g, '<Cell ss:StyleID="head">')}
   ${bodyXml}
  </Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob(['\ufeff', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const name = `${filename}.xls`;

  // 手机端优先走系统分享：可存到「文件」App 或直接发微信，比 blob 下载可靠得多
  // （微信内置浏览器会拦截 blob 下载，桌面浏览器则没有这个限制）
  try {
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    // 用户主动取消分享时直接结束，其它异常继续走下载兜底
    if (err && err.name === 'AbortError') return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 手机端下载启动慢，回收太早会导致"文件还没下就被撤销"
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
