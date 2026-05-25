// lt_i18n.ts
// ─────────────────────────────────────────────────────────────────────────────
// LearnerToolbelt — recommendation_text catalog for the Score Predictor +
// generic user-facing strings (Wave 5 — PLAN § 3.8 / § A4).
//
// Per § 7.4 the RPC owns translations (not the client), so Unity + Web get
// identical localised strings without per-platform bundles. We bake the
// dictionary inline (~150 lines) — the matching .json files at
// data/modules/src/learner-toolbelt/i18n/{locale}.json are the
// human-editable source of truth used by ai-content for QA loops.
//
// Key shape: "predictor.<exam_family>.<band>" where
//   exam_family ∈ { sat, jee, ap, neet, generic }
//   band        ∈ { low, mid, high, insufficient_data }
// Locales: en, hi, es, pt-BR, ar, id.
//
// English is hand-written. Other locales are seed translations sufficient
// for L0 launch; wave-7 will run the Firecrawl-verified QA pass per § 10.6.

namespace LearnerToolbelt {

  type LocaleDict = { [key: string]: string };

  var I18N_EN: LocaleDict = {
    "predictor.sat.high":  "You're trending toward {predicted} on the SAT (90% CI {ci_low}–{ci_high}). Solid Reading & Writing; keep Math sharp with 3 timed sets per week to hold the band.",
    "predictor.sat.mid":   "You're projecting around {predicted} on the SAT (90% CI {ci_low}–{ci_high}). Math is the cheapest lift: 6 hrs/wk of targeted drill should push you to 1350+.",
    "predictor.sat.low":   "Current trajectory: {predicted} on the SAT (90% CI {ci_low}–{ci_high}). Fundamentals first — alternate one R&W set and one Math set daily; expect +120 in 6 weeks.",
    "predictor.jee.high":  "You're trending toward {predicted} on JEE Main. Top 1% is in reach — protect Chemistry accuracy and time the JEE Advanced full mocks weekly.",
    "predictor.jee.mid":   "JEE Main projection: {predicted}. Mechanics + Inorganic Chem are your biggest residuals — 90 min/day on PYQs should compound fast.",
    "predictor.jee.low":   "JEE Main projection: {predicted}. Drop subject-jumping; commit to 14-day blocks per subject and rebuild from concept → solved-examples → PYQ.",
    "predictor.ap.high":   "Projected AP score: {predicted}. You're comfortably in the 5 band — switch to FRQ-only drills to lock the rubric edges.",
    "predictor.ap.mid":    "Projected AP score: {predicted}. Multiple-choice is fine; the boundary to 5 is FRQ pacing — 2 timed FRQs per week from official released exams.",
    "predictor.ap.low":    "Projected AP score: {predicted}. Focus on the 4–5 units College Board weights heaviest in your subject; ignore the long tail until you're consistently above 60% MCQ accuracy.",
    "predictor.neet.high": "NEET projection: {predicted} / 720. AIIMS-tier is realistic — protect Biology accuracy (single-mark errors cost ~80 ranks each).",
    "predictor.neet.mid":  "NEET projection: {predicted} / 720. Physics is your residual; 60 min/day on NCERT + 30 min on PYQ should add 40-60 marks in a month.",
    "predictor.neet.low":  "NEET projection: {predicted} / 720. Pivot to Biology NCERT line-by-line for the next 21 days — single highest ROI on the syllabus.",
    "predictor.generic.high":"You're in the {predicted} of QuizVerse users for this exam track. Maintain volume and add timed full-length mocks weekly.",
    "predictor.generic.mid": "You're at the {predicted} of QuizVerse users for this exam. Two weak topics drag your average — switch to topic-focused 10-question sets.",
    "predictor.generic.low": "You're at the {predicted} of QuizVerse users on this track. Foundation-first: 5-question warmups daily, no full-length mocks for 2 weeks.",
    "predictor.sat.insufficient_data":  "Play at least 8 SAT-tagged quizzes (5 minutes each) and we'll surface a band. Until then we won't fake a number.",
    "predictor.jee.insufficient_data":  "Play at least 8 JEE-tagged quizzes and we'll surface a percentile band. Until then we won't fake a number.",
    "predictor.ap.insufficient_data":   "Play at least 8 AP-tagged quizzes (in your subject) and we'll surface a score band.",
    "predictor.neet.insufficient_data": "Play at least 8 NEET-tagged quizzes and we'll surface a score band.",
    "predictor.generic.insufficient_data":"Play at least 8 quizzes tagged to this exam and we'll surface a confidence band.",
    "calendar.no_results": "No exam-calendar entries known for the requested country and year yet.",
    "school.no_results":   "No matching schools — try the free-text path so we can add yours.",
  };

  var I18N_HI: LocaleDict = {
    "predictor.sat.high":  "आप SAT में लगभग {predicted} की ओर बढ़ रहे हैं (90% CI {ci_low}–{ci_high}). Reading & Writing ठीक है; Math को साधने के लिए हफ्ते में 3 timed sets करें.",
    "predictor.sat.mid":   "SAT में अनुमानित स्कोर {predicted} (90% CI {ci_low}–{ci_high}). सबसे आसान सुधार Math में है — हफ्ते में 6 घंटे drill से 1350+ संभव है.",
    "predictor.sat.low":   "वर्तमान दिशा: SAT में {predicted} (90% CI {ci_low}–{ci_high}). पहले बुनियाद — रोज़ एक R&W और एक Math set, 6 हफ्तों में +120 अंक.",
    "predictor.jee.high":  "JEE Main में आपका रुख {predicted} की ओर है. शीर्ष 1% पहुँच में है — Chemistry की सटीकता बनाए रखें और JEE Advanced के पूर्ण mocks साप्ताहिक करें.",
    "predictor.jee.mid":   "JEE Main अनुमान: {predicted}. Mechanics और Inorganic Chemistry सबसे बड़े अंतर हैं — रोज़ 90 मिनट PYQ पर लगाएँ.",
    "predictor.jee.low":   "JEE Main अनुमान: {predicted}. विषय बदलना बंद करें; 14-दिन के ब्लॉक में एक विषय पूरा करें: concept → हल किए उदाहरण → PYQ.",
    "predictor.ap.high":   "अनुमानित AP स्कोर: {predicted}. आप आराम से 5-band में हैं — अब केवल FRQ drills पर ध्यान दें ताकि rubric के किनारे पक्के हो जाएँ.",
    "predictor.ap.mid":    "अनुमानित AP स्कोर: {predicted}. MCQ ठीक है; 5 तक पहुँचने की दीवार FRQ pacing है — आधिकारिक released exams से हफ्ते में 2 timed FRQ.",
    "predictor.ap.low":    "अनुमानित AP स्कोर: {predicted}. आपके विषय में College Board सबसे ज़्यादा भार जिन 4–5 units पर देता है, उन पर ध्यान दें.",
    "predictor.neet.high": "NEET अनुमान: {predicted} / 720. AIIMS-स्तर पहुँच में है — Biology की सटीकता बनाए रखें (हर एक-नंबर की गलती ~80 रैंक महँगी पड़ती है).",
    "predictor.neet.mid":  "NEET अनुमान: {predicted} / 720. Physics सबसे बड़ा अंतर है; रोज़ 60 मिनट NCERT और 30 मिनट PYQ से एक महीने में 40-60 अंक संभव हैं.",
    "predictor.neet.low":  "NEET अनुमान: {predicted} / 720. अगले 21 दिन Biology NCERT लाइन-दर-लाइन पढ़ें — पूरे सिलेबस में सबसे अच्छा ROI.",
    "predictor.generic.high":"इस परीक्षा के ट्रैक पर आप QuizVerse उपयोगकर्ताओं के {predicted} में हैं. मात्रा बनाए रखें और हफ्ते में timed full-length mocks जोड़ें.",
    "predictor.generic.mid": "इस परीक्षा पर आप QuizVerse उपयोगकर्ताओं के {predicted} में हैं. दो कमज़ोर विषय आपका औसत खींच रहे हैं — topic-focused 10-question sets पर बदलें.",
    "predictor.generic.low": "इस ट्रैक पर आप QuizVerse उपयोगकर्ताओं के {predicted} में हैं. पहले बुनियाद: रोज़ 5-question warmups, 2 हफ्तों तक full-length mocks नहीं.",
    "predictor.sat.insufficient_data":  "कम से कम 8 SAT-tagged quizzes (हर एक 5 मिनट) खेलें, तब हम band दिखाएँगे. नकली नंबर नहीं देंगे.",
    "predictor.jee.insufficient_data":  "कम से कम 8 JEE-tagged quizzes खेलें, तब percentile band दिखेगा. नकली नंबर नहीं देंगे.",
    "predictor.ap.insufficient_data":   "कम से कम 8 AP-tagged quizzes (अपने subject में) खेलें, तब score band दिखाएँगे.",
    "predictor.neet.insufficient_data": "कम से कम 8 NEET-tagged quizzes खेलें, तब score band दिखाएँगे.",
    "predictor.generic.insufficient_data":"इस परीक्षा से tagged कम से कम 8 quizzes खेलें, तब confidence band दिखाएँगे.",
    "calendar.no_results": "अनुरोधित देश और वर्ष के लिए कोई exam-calendar entry अभी उपलब्ध नहीं है.",
    "school.no_results":   "कोई मेल खाता स्कूल नहीं मिला — free-text path आज़माएँ ताकि हम आपका जोड़ सकें.",
  };

  var I18N_ES: LocaleDict = {
    "predictor.sat.high":  "Tu trayectoria apunta a {predicted} en el SAT (IC 90% {ci_low}–{ci_high}). Reading & Writing está sólido; mantén Math con 3 sets cronometrados por semana.",
    "predictor.sat.mid":   "Proyección SAT: {predicted} (IC 90% {ci_low}–{ci_high}). El mayor margen está en Math — 6 h/semana de drill enfocado debería llevarte a 1350+.",
    "predictor.sat.low":   "Trayectoria actual: {predicted} en el SAT (IC 90% {ci_low}–{ci_high}). Primero los fundamentos — alterna un set de R&W y uno de Math al día; +120 en 6 semanas.",
    "predictor.jee.high":  "JEE Main: tendencia a {predicted}. El top 1% está al alcance — cuida la precisión en Chemistry y haz mocks completos semanales.",
    "predictor.jee.mid":   "Proyección JEE Main: {predicted}. Mechanics + Inorganic Chemistry son tus mayores residuos — 90 min/día de PYQs.",
    "predictor.jee.low":   "Proyección JEE Main: {predicted}. Deja de saltar entre materias; bloques de 14 días por materia: concepto → ejemplos → PYQ.",
    "predictor.ap.high":   "AP proyectado: {predicted}. Estás cómodamente en banda de 5 — pasa a drills solo de FRQ para ajustar la rúbrica.",
    "predictor.ap.mid":    "AP proyectado: {predicted}. MCQ está bien; el límite para llegar a 5 es el ritmo de FRQ — 2 FRQ cronometrados a la semana.",
    "predictor.ap.low":    "AP proyectado: {predicted}. Concéntrate en las 4–5 unidades que más peso tienen en tu asignatura; ignora la cola larga.",
    "predictor.neet.high": "NEET: {predicted} / 720 proyectado. Banda AIIMS al alcance — protege la precisión en Biología.",
    "predictor.neet.mid":  "NEET: {predicted} / 720. Física es tu residuo; 60 min/día NCERT + 30 min PYQ deberían sumar 40-60 marks en un mes.",
    "predictor.neet.low":  "NEET: {predicted} / 720. Pivot a NCERT de Biología línea por línea durante 21 días — el mejor ROI del temario.",
    "predictor.generic.high":"Estás en el {predicted} de los usuarios de QuizVerse para este examen. Mantén volumen y añade mocks completos cronometrados semanalmente.",
    "predictor.generic.mid": "Estás en el {predicted} de los usuarios de QuizVerse. Dos temas débiles arrastran tu promedio — pasa a sets de 10 preguntas por tema.",
    "predictor.generic.low": "Estás en el {predicted} de los usuarios de QuizVerse. Fundamentos primero: 5 preguntas diarias de warmup, sin mocks completos por 2 semanas.",
    "predictor.sat.insufficient_data":  "Juega al menos 8 quizzes etiquetados como SAT y mostraremos una banda. No vamos a inventar un número.",
    "predictor.jee.insufficient_data":  "Juega al menos 8 quizzes etiquetados como JEE y mostraremos una banda de percentil.",
    "predictor.ap.insufficient_data":   "Juega al menos 8 quizzes etiquetados como AP (en tu asignatura) y mostraremos una banda.",
    "predictor.neet.insufficient_data": "Juega al menos 8 quizzes etiquetados como NEET y mostraremos una banda.",
    "predictor.generic.insufficient_data":"Juega al menos 8 quizzes etiquetados con este examen y mostraremos una banda de confianza.",
    "calendar.no_results": "No hay entradas conocidas de calendario de exámenes para el país y año solicitados.",
    "school.no_results":   "Sin colegios que coincidan — usa el modo de texto libre para añadir el tuyo.",
  };

  var I18N_PT_BR: LocaleDict = {
    "predictor.sat.high":  "Você está mirando {predicted} no SAT (IC 90% {ci_low}–{ci_high}). Reading & Writing está consistente; mantenha Math com 3 sets cronometrados por semana.",
    "predictor.sat.mid":   "Projeção SAT: {predicted} (IC 90% {ci_low}–{ci_high}). O ganho mais barato está em Math — 6 h/semana de drill direcionado deve levar a 1350+.",
    "predictor.sat.low":   "Trajetória atual: {predicted} no SAT (IC 90% {ci_low}–{ci_high}). Fundamentos primeiro — alterne um set de R&W e um de Math por dia; +120 em 6 semanas.",
    "predictor.jee.high":  "JEE Main: tendência {predicted}. Top 1% está ao alcance — proteja precisão em Chemistry e faça mocks completos semanais.",
    "predictor.jee.mid":   "Projeção JEE Main: {predicted}. Mechanics + Inorganic Chemistry são seus maiores resíduos — 90 min/dia em PYQs.",
    "predictor.jee.low":   "Projeção JEE Main: {predicted}. Pare de pular entre matérias; blocos de 14 dias por matéria: conceito → exemplos → PYQ.",
    "predictor.ap.high":   "AP projetado: {predicted}. Banda 5 confortável — passe a drills somente de FRQ.",
    "predictor.ap.mid":    "AP projetado: {predicted}. MCQ está bom; o limite para 5 é ritmo em FRQ — 2 FRQs cronometradas por semana.",
    "predictor.ap.low":    "AP projetado: {predicted}. Foque nas 4–5 unidades de maior peso do College Board para sua matéria.",
    "predictor.neet.high": "NEET projetado: {predicted} / 720. Banda AIIMS realista — proteja precisão em Biologia.",
    "predictor.neet.mid":  "NEET projetado: {predicted} / 720. Física é seu resíduo; 60 min/dia NCERT + 30 min PYQ devem somar 40-60 marks em um mês.",
    "predictor.neet.low":  "NEET projetado: {predicted} / 720. Pivot para NCERT de Biologia linha-por-linha por 21 dias.",
    "predictor.generic.high":"Você está no {predicted} dos usuários QuizVerse para este exame. Mantenha volume e adicione mocks completos cronometrados semanalmente.",
    "predictor.generic.mid": "Você está no {predicted} dos usuários QuizVerse. Dois tópicos fracos puxam sua média — passe para sets de 10 perguntas por tópico.",
    "predictor.generic.low": "Você está no {predicted} dos usuários QuizVerse. Fundamentos primeiro: 5 perguntas/dia de warmup, sem mocks por 2 semanas.",
    "predictor.sat.insufficient_data":  "Jogue ao menos 8 quizzes tagueados como SAT e mostraremos uma banda. Não vamos inventar número.",
    "predictor.jee.insufficient_data":  "Jogue ao menos 8 quizzes tagueados como JEE e mostraremos uma banda de percentil.",
    "predictor.ap.insufficient_data":   "Jogue ao menos 8 quizzes tagueados como AP (na sua matéria) e mostraremos uma banda.",
    "predictor.neet.insufficient_data": "Jogue ao menos 8 quizzes tagueados como NEET e mostraremos uma banda.",
    "predictor.generic.insufficient_data":"Jogue ao menos 8 quizzes tagueados a este exame e mostraremos uma banda de confiança.",
    "calendar.no_results": "Não há entradas de calendário de exames conhecidas para o país e ano solicitados.",
    "school.no_results":   "Nenhuma escola compatível — use o modo de texto livre para adicionar a sua.",
  };

  var I18N_AR: LocaleDict = {
    "predictor.sat.high":  "تتجه نحو {predicted} في الـ SAT (مجال ثقة 90% {ci_low}–{ci_high}). القراءة والكتابة جيدتان؛ احتفظ بالرياضيات بثلاث مجموعات موقوتة أسبوعياً.",
    "predictor.sat.mid":   "توقع SAT: {predicted} (مجال ثقة 90% {ci_low}–{ci_high}). أرخص رفع في الرياضيات — 6 ساعات/أسبوع تمارين موجهة ترفعك إلى 1350+.",
    "predictor.sat.low":   "المسار الحالي: {predicted} في الـ SAT (مجال ثقة 90% {ci_low}–{ci_high}). الأساسيات أولاً — يومياً مجموعة قراءة ومجموعة رياضيات؛ +120 خلال 6 أسابيع.",
    "predictor.jee.high":  "JEE Main: التوجه نحو {predicted}. الـ 1% الأعلى في المتناول — حافظ على دقة الكيمياء وامتحانات تجريبية كاملة أسبوعياً.",
    "predictor.jee.mid":   "توقع JEE Main: {predicted}. الميكانيكا والكيمياء غير العضوية أكبر الفجوات — 90 دقيقة/يوم على PYQs.",
    "predictor.jee.low":   "توقع JEE Main: {predicted}. لا تقفز بين المواد؛ كتل 14 يوماً لكل مادة: مفهوم → أمثلة → PYQ.",
    "predictor.ap.high":   "AP المتوقع: {predicted}. ضمن نطاق 5 بأريحية — انتقل إلى تمارين FRQ فقط لإحكام المعايير.",
    "predictor.ap.mid":    "AP المتوقع: {predicted}. الاختيار من متعدد جيد؛ الحد الفاصل للوصول إلى 5 هو إيقاع FRQ — اثنان موقتان أسبوعياً.",
    "predictor.ap.low":    "AP المتوقع: {predicted}. ركّز على 4–5 وحدات يعطيها College Board أكبر وزن في مادتك.",
    "predictor.neet.high": "NEET المتوقع: {predicted} / 720. AIIMS واقعي — احم دقة الأحياء.",
    "predictor.neet.mid":  "NEET المتوقع: {predicted} / 720. الفيزياء هي الفجوة؛ 60 دقيقة/يوم NCERT + 30 دقيقة PYQ تضيف 40-60 درجة شهرياً.",
    "predictor.neet.low":  "NEET المتوقع: {predicted} / 720. ركّز على NCERT للأحياء سطراً بسطر لمدة 21 يوماً.",
    "predictor.generic.high":"أنت في الـ {predicted} من مستخدمي QuizVerse لهذا الامتحان. حافظ على الحجم وأضف امتحانات تجريبية كاملة أسبوعياً.",
    "predictor.generic.mid": "أنت في الـ {predicted} من مستخدمي QuizVerse. موضوعان ضعيفان يسحبان معدلك — انتقل إلى مجموعات 10 أسئلة لكل موضوع.",
    "predictor.generic.low": "أنت في الـ {predicted} من مستخدمي QuizVerse. الأساسيات أولاً: 5 أسئلة تمهيدية يومياً، بدون امتحانات كاملة لأسبوعين.",
    "predictor.sat.insufficient_data":  "العب 8 اختبارات SAT على الأقل لنعرض لك نطاقاً. لن نخترع رقماً.",
    "predictor.jee.insufficient_data":  "العب 8 اختبارات JEE على الأقل لنعرض لك نطاق نسبة مئوية.",
    "predictor.ap.insufficient_data":   "العب 8 اختبارات AP على الأقل (في مادتك) لنعرض لك نطاقاً.",
    "predictor.neet.insufficient_data": "العب 8 اختبارات NEET على الأقل لنعرض لك نطاقاً.",
    "predictor.generic.insufficient_data":"العب 8 اختبارات على الأقل موسومة بهذا الامتحان لنعرض لك نطاق ثقة.",
    "calendar.no_results": "لا توجد إدخالات تقويم امتحانات معروفة للبلد والسنة المطلوبين بعد.",
    "school.no_results":   "لم نجد مدارس مطابقة — جرب وضع النص الحر لإضافة مدرستك.",
  };

  var I18N_ID: LocaleDict = {
    "predictor.sat.high":  "Kamu mengarah ke {predicted} di SAT (CI 90% {ci_low}–{ci_high}). Reading & Writing solid; jaga Math dengan 3 set berwaktu per minggu.",
    "predictor.sat.mid":   "Proyeksi SAT: {predicted} (CI 90% {ci_low}–{ci_high}). Peningkatan termurah di Math — 6 jam/minggu drill terarah harus membawamu ke 1350+.",
    "predictor.sat.low":   "Lintasan saat ini: {predicted} di SAT (CI 90% {ci_low}–{ci_high}). Fundamental dulu — selang-seling satu set R&W dan satu Math per hari; +120 dalam 6 minggu.",
    "predictor.jee.high":  "JEE Main: tren {predicted}. Top 1% terjangkau — jaga akurasi Chemistry dan mock penuh mingguan.",
    "predictor.jee.mid":   "Proyeksi JEE Main: {predicted}. Mechanics + Inorganic Chemistry adalah residu terbesar — 90 menit/hari PYQ.",
    "predictor.jee.low":   "Proyeksi JEE Main: {predicted}. Berhenti lompat-lompat mata pelajaran; blok 14 hari per mata pelajaran: konsep → contoh → PYQ.",
    "predictor.ap.high":   "AP proyeksi: {predicted}. Band 5 nyaman — beralih ke drill FRQ saja.",
    "predictor.ap.mid":    "AP proyeksi: {predicted}. MCQ aman; batas ke 5 adalah ritme FRQ — 2 FRQ berwaktu per minggu.",
    "predictor.ap.low":    "AP proyeksi: {predicted}. Fokus pada 4–5 unit yang paling diberi bobot College Board untuk mata pelajaranmu.",
    "predictor.neet.high": "NEET proyeksi: {predicted} / 720. Tier AIIMS realistis — jaga akurasi Biologi.",
    "predictor.neet.mid":  "NEET proyeksi: {predicted} / 720. Fisika adalah residumu; 60 menit/hari NCERT + 30 menit PYQ menambah 40-60 nilai sebulan.",
    "predictor.neet.low":  "NEET proyeksi: {predicted} / 720. Pivot ke NCERT Biologi baris demi baris selama 21 hari.",
    "predictor.generic.high":"Kamu berada di {predicted} pengguna QuizVerse untuk ujian ini. Jaga volume dan tambahkan mock penuh berwaktu mingguan.",
    "predictor.generic.mid": "Kamu berada di {predicted} pengguna QuizVerse. Dua topik lemah menarik rata-ratamu — beralih ke set 10 pertanyaan per topik.",
    "predictor.generic.low": "Kamu berada di {predicted} pengguna QuizVerse. Fundamental dulu: 5 pertanyaan warmup harian, tanpa mock penuh selama 2 minggu.",
    "predictor.sat.insufficient_data":  "Mainkan setidaknya 8 quiz bertag SAT lalu kami akan menampilkan band. Kami tidak akan mengarang angka.",
    "predictor.jee.insufficient_data":  "Mainkan setidaknya 8 quiz bertag JEE lalu kami akan menampilkan band persentil.",
    "predictor.ap.insufficient_data":   "Mainkan setidaknya 8 quiz bertag AP (di mata pelajaranmu) lalu kami akan menampilkan band.",
    "predictor.neet.insufficient_data": "Mainkan setidaknya 8 quiz bertag NEET lalu kami akan menampilkan band.",
    "predictor.generic.insufficient_data":"Mainkan setidaknya 8 quiz bertag ujian ini lalu kami akan menampilkan band kepercayaan.",
    "calendar.no_results": "Belum ada entri kalender ujian yang diketahui untuk negara dan tahun yang diminta.",
    "school.no_results":   "Tidak ada sekolah yang cocok — gunakan jalur teks bebas agar kami menambahkan sekolahmu.",
  };

  var I18N_BUNDLES: { [locale: string]: LocaleDict } = {
    "en": I18N_EN,
    "hi": I18N_HI,
    "es": I18N_ES,
    "pt-BR": I18N_PT_BR,
    "ar": I18N_AR,
    "id": I18N_ID,
  };

  function examFamilyForKey(examId: string): string {
    var id = ("" + (examId || "")).toLowerCase();
    if (id.indexOf("sat") === 0) return "sat";
    if (id.indexOf("jee") === 0) return "jee";
    if (id.indexOf("ap") === 0 || id.indexOf("ap_") === 0) return "ap";
    if (id.indexOf("neet") === 0) return "neet";
    return "generic";
  }

  export function i18nRecommendation(locale: string, examId: string, band: string): string {
    var loc = ("" + (locale || "en"));
    var bundle = I18N_BUNDLES[loc] || I18N_BUNDLES["en"];
    var key = "predictor." + examFamilyForKey(examId) + "." + band;
    if (bundle[key]) return bundle[key];
    // fall back to English
    if (I18N_BUNDLES["en"][key]) return I18N_BUNDLES["en"][key];
    return "";
  }

  export function i18nString(locale: string, key: string): string {
    var bundle = I18N_BUNDLES[locale] || I18N_BUNDLES["en"];
    return bundle[key] || I18N_BUNDLES["en"][key] || "";
  }
}
