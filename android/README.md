# MindVault Android APK

Установочный APK на ~37 КБ. Внутри — тот же PWA из родительской папки, обёрнутый в нативный WebView.

## Установка на телефон

1. Скачай `MindVault.apk` себе на телефон (Telegram/email/USB/Google Drive)
2. Открой файл через файловый менеджер или из загрузок
3. Android спросит «Разрешить установку из этого источника?» — разреши (Chrome / файловому менеджеру, через который качал)
4. Установить
5. Готово — иконка с буквой M на рабочем столе

## Что внутри

| Элемент | Назначение |
|---|---|
| `AndroidManifest.xml` | Манифест приложения, разрешения, активность |
| `src/com/mindvault/app/MainActivity.java` | Активность с WebView, грузит `assets/index.html` |
| `res/values/strings.xml`, `styles.xml` | Имя приложения и тема (Material, фиолетовая статус-бар) |
| `res/mipmap-xxxhdpi/ic_launcher.png` | Иконка |
| `build.sh` | Скрипт сборки APK |
| `MindVault.apk` | Готовый подписанный APK (debug-ключом) |

## Что работает / что нет в APK-версии

| Функция | Статус |
|---|---|
| Ввод текста, автокатегоризация, список | ✅ |
| Поиск, фильтры, отметка «Выполнено» | ✅ |
| Статистика | ✅ |
| Сохранение между запусками (localStorage) | ✅ |
| Экспорт в JSON | ✅ |
| Голосовой ввод | ⚠️ Системный WebView не имеет встроенного Speech-to-Text, как Chrome. Кнопка может не сработать. На реальной нативной версии подключим Android SpeechRecognizer |
| Service Worker (офлайн-кэш) | ⚠️ `file://`-схема не позволяет SW. Не критично — все ассеты и так в APK |
| Пуш-напоминание в фоне | ❌ Нужно перейти на нативный AlarmManager + NotificationManager |

## Пересборка APK после изменения PWA

После правок в `../index.html`, `../sw.js` и пр.:

```bash
cd android
./build.sh
```

В корне `android/` появится новый `MindVault.apk`.

Зависимости (Ubuntu/Debian):

```bash
apt install -y openjdk-11-jdk-headless android-sdk \
  android-sdk-build-tools android-sdk-platform-23 \
  apksigner zipalign aapt
# dx.jar (классический Java→Dex компилятор)
mkdir -p /opt/dex && curl -sSL -o /opt/dex/dx.jar \
  https://repo1.maven.org/maven2/com/google/android/tools/dx/1.7/dx-1.7.jar
```

## Подпись

Текущий APK подписан **debug-ключом** (`debug.keystore` с паролем `android`). Для публикации в магазины (RuStore / Google Play / NashStore) нужно сгенерировать собственный **release-ключ** и пересобрать:

```bash
keytool -genkeypair -keystore my-release.keystore -alias mindvault \
  -keyalg RSA -keysize 4096 -validity 25000 \
  -dname "CN=Your Name,O=Your Company,C=RU"
```

И заменить `apksigner sign` в `build.sh` на свой keystore. **ВАЖНО:** этот ключ нужно хранить вечно — без него ты не сможешь публиковать обновления того же приложения.

## Версия и API

- minSdkVersion: 21 (Android 5.0+)
- targetSdkVersion: 23 (Android 6.0)
- versionCode: 1, versionName: 0.1

`targetSdkVersion 23` ограничено окружением сборки. Для публикации в RuStore/Google Play нужно повысить до 33+, что требует более новой Android Build Tools и платформы — мигрируем при переходе на нормальный билд-сервер.