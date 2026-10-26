export function changesScannedSource(report, selected) {
  return Boolean(report?.repository && selected &&
    (selected.repository !== report.repository || selected.commit !== report.commit));
}
