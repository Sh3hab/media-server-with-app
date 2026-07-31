<table>
  <tr>
    <td>
      <img src="/assets/logo.png" width="150">
    </td>
  </tr>
</table>


# media server | ميديا سيرفر

**منظومة بث سينمائي سحابية شاملة (Full-Stack Streaming & CMS Ecosystem)**  
تدمج بين خادم **Node.js High-Performance API** وتطبيق هجين عالي الأداء مبني بـ **Flutter**.

[![Flutter](https://img.shields.io/badge/Client-Flutter_Cross__Platform-02569B?style=for-the-badge&logo=flutter)](#)
[![Node.js](https://img.shields.io/badge/Backend-Node.js_Express-339933?style=for-the-badge&logo=nodedotjs)](#)
[![TMDB Integration](https://img.shields.io/badge/Metadata-TMDB_API_Auto--Sync-01b4e4?style=for-the-badge&logo=themoviedb)](#)
[![Android Support](https://img.shields.io/badge/Platform-Android_Native-3DDC84?style=for-the-badge&logo=android)](#)
[![Architecture](https://img.shields.io/badge/Architecture-Clean__Architecture-8A2BE2?style=for-the-badge)](#)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](#)

</div>

---

##  نظرة هندسية (System Overview)

**ميديا سيرفر** ليس مجرد منصة عرض، بل هو منظومة متكاملة لتقديم تجربة بث سينمائية عالية الأداء. يعتمد الباك أند على نظام **File-based JSON Storage** لضمان سرعة الاستجابة وسهولة النقل، مع ربط مباشر بـ **TMDB API** لجلب البيانات تلقائياً. 

يتكامل الخادم مع **تطبيق Flutter** محمول يدعم نظام Android جاهز للتوسع لأي منصة Native أخرى، مع إدارة كاملة للتنزيل المحلي وسجل المشاهدة.

---

##  أبرز المميزات (Key Features)

###  تطبيق العميل (Flutter Client App)
* ** دعم الأجهزة المحمولة (Cross-Platform):** دعم كامل لنظام Android مع بنية مهيأة للعمل على بقية الأنظمة المدمجة (iOS/Desktop Native).
* ** مدير التحميلات (Offline Downloader):** نظام محلي لحفظ وتنزيل مقاطع الفيديو والأفلام للمشاهدة بدون اتصال بالإنترنت.
* ** سجل المشاهدة ومتابعة التشغيل (Watch History & Resume):** حفظ تلقائي للنقطة الزمنية لكل فيديو مع شريط تقدم محلي وخادم.
* ** محرك اكتشاف متقدم:** استكشاف وسائط الفيديو وتصفح الممثلين، التصنيفات، وسلاسل المسلسلات والحلقات.

---

###  الخادم ولوحة التحكم (Node.js Backend & CMS)
* ** الربط المباشر مع TMDB API:** جلب البيانات الوصفية (البوسترات، الخلفيات، السير الذاتية، طاقم التمثيل، والتقييمات) تلقائياً بنقرة واحدة.
* ** نظام تخزين سريع (Low-Latency JSON DB):** معالجة لملفات البيانات بدون التعقيد البرمجي لقواعد البيانات التقليدية.
* ** نظام أمان الحسابات:** حماية مسارات الـ API وإدارة الرفع باستخدام التوكنز (`x-admin-token`).
* ** محرك التوافقية للترجمات (Subtitle Engine):** تحويل تلقائي وتصحيح ترميز ملفات الترجمة من `SRT` إلى `VTT` لمعالجة الـ `UTF-8`.

---

##  البنية التقنية (Tech Stack Overview)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          meida server ECOSYSTEM                      │
└────────────────────────────────────────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌──────────────────────────────────┐        ┌────────────────────────────┐
│   📱 Client Application          │        │   ⚡ Backend & Storage     │
├──────────────────────────────────┤        ├────────────────────────────┤
│ • Framework: Flutter (Dart)      │        │ • Engine: Node.js + Express│
│ • State: Bloc / Provider         │ ◄────► │ • Metadata: TMDB API V3    │
│ • Offline: Local Storage         │        │ • DB: Dynamic SQLite  │
│ • Player: Custom Video Engine    │        │ • Uploads: Multer Pipeline │
└──────────────────────────────────┘        └────────────────────────────┘
المكون (Component)التقنية (Technology)الدور التقني (Purpose)Client AppFlutter (Dart)واجهة سينمائية لدعم البث والتنزيلات وسجل المشاهدة (Android Native).Backend APINode.js + Expressمعالجة الطلبات، حماية المسارات، وتقديم ملفات الوسائط.Metadata IntegrationTMDB API V3إمداد السيرفر بالبيانات، الصور، والحلقات والممثلين تلقائياً.DatabaseJSON Systemتخزين البيانات الوصفية وعلاقات الأفلام والممثلين.Media PlayerVideo.js / Video Playerتشغيل البث التكيفي وعرض مسارات الترجمة. خارطة المسارات والـ API (Routing Matrix) مسارات تطبيق الويب والعميل (Client Routes)المسار / الهوكالوظيفة#/homeجلب وعرض أحدث الأفلام، المسلسلات، والسلايدر التفاعلي.#/details?id={id}استدعاء بيانات المحتوى (فيديو، طاقم العمل، الحلقات).Offline Storageإدارة تنزيل الحلقات وسجل المشاهدة محلياً على الهاتف. مسارات لوحة التحكم والـ API (Admin & Services)الـ Methodالمسار (Endpoint)الوظيفةGET/api/dataجلب كائن قاعدة البيانات بالكامل.POST/api/tmdb/importالاستعلام من TMDB API وسحب بيانات المحتوى والممثلين.POST/api/uploadاستقبال الصور والفيديوهات والترجمات وفلترتها عبر Multer.PUT/api/series/:idتحديث الحلقات والمحتوى وإعادة كتابة ملف الـ JSON. الهيكل التنظيمي (Directory Structure)Plaintextmedia server/
├── client_flutter/             # تطبيق الموبايل (Android Native & Cross-Platform)
│   ├── lib/
│   │   ├── core/                  # خدمات التنزيل وسجل المشاهدة
│   │   ├── data/                  # مزودات البيانات والاتصال بالـ API
│   │   └── presentation/          # الواجهات ومشغلات الفيديو
│   └── pubspec.yaml
│
└── ⚡ server_backend/              # الخادم ولوحة التحكم
    ├── server.js                # محرك الـ API والربط مع TMDB
    ├── index.html               # واجهة المستعرض السينمائية
    ├── admin.html               # لوحة إدخال وإدارة المحتوى (CMS)
    ├── conv.html                # محرك تحويل الترجمات (SRT -> VTT)
    ├── data/                    # قاعدة البيانات المحلية (JSON DB)
    │   ├── db.sql                 # السجلات (أفلام، مسلسلات، ممثلين)
    │   └── admins.json             # بيانات الاعتماد
    └── uploads/                 # مجلد الوسائط
        ├── posters/                # الأغلفة وخلفيات TMDB
        ├── actors/                 # صور الممثلين
        └── episodes/               # الحلقات والترجمات
التشغيل السريع (Getting Started)1️ إعداد الخادم (Backend)Bashcd server_backend
npm install
npm start
 إعداد تطبيق FlutterBashcd client_flutter
flutter pub get
flutter run

---

<ElicitationsGroup message="ما الخطوة التالية التي تفضل العمل عليها؟">
  <Elicitation label="إضافة شرح تفصيلي لربط مفتاح TMDB API في السيرفر" query="أضف قسماً لملف README يشرح كيفية ضبط واستخدام TMDB API Key داخل ملف server.js"/>
  <Elicitation label="توثيق شاشات تطبيق Flutter" query="اكتب قسماً مخصصاً يشرح بنية شاشات Flutter (التنزيلات، سجل المشاهدة، مشغل الفيديو)"/>
</ElicitationsGroup>
