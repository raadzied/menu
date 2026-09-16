; === منيو ون: إعدادات NSIS مخصّصة ===
; إضافة/إزالة قواعد جدار الحماية تلقائيًا كي تصل جوالات الزبائن على شبكة
; المطعم إلى الخادم (منفذا 3000 للتطبيق و80 لبوابة التقاط Wi‑Fi).

!macro customInstall
  DetailPrint "Configuring Windows Firewall for Menu One (LAN access for guests' phones)..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Menu One - Restaurant Server (3000)" dir=in action=allow protocol=TCP localport=3000 profile=any enable=yes'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Menu One - Capture Portal (80)" dir=in action=allow protocol=TCP localport=80 profile=any enable=yes'
!macroend

!macro customUnInstall
  DetailPrint "Removing Menu One firewall rules..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Menu One - Restaurant Server (3000)"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Menu One - Capture Portal (80)"'
!macroend
