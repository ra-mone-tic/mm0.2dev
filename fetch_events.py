#!/usr/bin/env python3
"""
MeowAfisha · fetch_events.py
Обновлено для парсинга с Google Sheets
"""

import os
import json
import sys
import time
import re
from pathlib import Path
from io import StringIO

# Опциональная загрузка .env для локальной разработки
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd
from geopy.geocoders import ArcGIS, Yandex, Nominatim
from geopy.extra.rate_limiter import RateLimiter
import geopy.exc

# Configure logging
import logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
if not logger.handlers:
    logger.addHandler(handler)

# Also log to file
file_handler = logging.FileHandler('fetch_events.log', encoding='utf-8')
file_handler.setLevel(logging.INFO)
formatter_file = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
file_handler.setFormatter(formatter_file)
logger.addHandler(file_handler)

# ─────────── НАСТРОЙКА ───────────
GOOGLE_SHEETS_ID = "1kHtf37vJhO8nlzQo2WA2awPjp8gJocxy830yigPAxKg"
GOOGLE_SHEETS_URL = f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEETS_ID}/export?format=csv"

# Задержки между запросами геокодинга (секунды)
DEFAULT_DELAYS = {
    'ARCGIS': float(os.getenv("ARCGIS_MIN_DELAY", "1.0")),
    'YANDEX': float(os.getenv("YANDEX_MIN_DELAY", "1.0")),
    'NOMINATIM': float(os.getenv("NOMINATIM_MIN_DELAY", "1.0"))
}

# Опциональный вывод лога в файл
GEOCODE_SAVE_LOG = os.getenv("GEOCODE_SAVE_LOG", "1") == "1"

OUTPUT_JSON = Path("events.json")
CACHE_FILE = Path("geocode_cache.json")
LOG_FILE = Path("geocode_log.json")

# ─────────── УТИЛИТЫ ───────────
def init_session() -> requests.Session:
    """Создать сессию requests с логикой повтора."""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

session = init_session()

# Инициализация геокодеров
arcgis = ArcGIS(timeout=10)
yandex = Yandex(api_key=os.getenv("YANDEX_KEY"), timeout=10, user_agent="meowafisha-script") if os.getenv("YANDEX_KEY") else None
nominatim_url = os.getenv("NOMINATIM_URL", "").strip()
if nominatim_url:
    nominatim = Nominatim(user_agent=os.getenv("NOMINATIM_USER_AGENT", "meowafisha-bot"), timeout=10, domain=nominatim_url)
else:
    nominatim = Nominatim(user_agent=os.getenv("NOMINATIM_USER_AGENT", "meowafisha-bot"), timeout=10)

# Ограничители скорости (осторожные 1 запрос/с на сервис)
arcgis_geocode = RateLimiter(arcgis.geocode, min_delay_seconds=DEFAULT_DELAYS['ARCGIS']) if arcgis else None
yandex_geocode = RateLimiter(lambda addr: yandex.geocode(addr, region='RU'), min_delay_seconds=DEFAULT_DELAYS['YANDEX']) if yandex else None
nominatim_geocode = RateLimiter(lambda addr: nominatim.geocode(addr, country_codes=['RU']), min_delay_seconds=DEFAULT_DELAYS['NOMINATIM']) if nominatim else None

GEOCODERS = [
    {"name": "ArcGIS", "func": arcgis_geocode},
    {"name": "Yandex", "func": yandex_geocode},
    {"name": "Nominatim", "func": nominatim_geocode},
]

# ─────────── КОНСТАНТЫ ───────────
CITY_WORDS = r"(калининград|гурьевск|светлогорск|янтарный|зеленоградск|пионерский|балтийск|поселок|пос\.|г\.)"

# Временный лог геокодинга
geolog = {}
geocache = {}
original_cache = {}

def log_geocoding(addr: str, provider: str, success: bool, detail: str = ""):
    """Расширенное логирование со структурными уровнями."""
    msg = f"[{provider:9}] {'OK ' if success else 'N/A'} | {addr}"
    if detail:
        msg += f" → {detail}"

    level = logging.INFO if success else logging.WARNING
    logger.log(level, msg)

    # Сохранить в geolog для JSON экспорта
    if addr not in geolog:
        geolog[addr] = {}
    geolog[addr][provider] = {"success": success, "detail": detail}

def load_cache() -> dict:
    """Загрузить кэш геокодинга из файла с обработкой ошибок."""
    if not CACHE_FILE.exists():
        logger.info("Файл кэша не найден, начинаем с чистого")
        return {}

    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            cache = json.load(f)
        logger.info(f"Кэш загружен: {len(cache)} адресов")
        return cache
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Не удалось загрузить кэш: {e}, начинаем с чистого")
        return {}

def save_cache(cache: dict, force: bool = False) -> None:
    """Сохранить кэш геокодинга на диск."""
    if cache == original_cache and not force:
        logger.info("Кэш не изменился, пропускаем сохранение")
        return

    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
        logger.info(f"Кэш сохранен: {len(cache)} адресов")
    except IOError as e:
        logger.error(f"Не удалось сохранить кэш: {e}")

def geocode_addr(addr: str) -> tuple:
    """Каскадный геокодинг с обработкой ошибок."""
    global geocache
    if not isinstance(geocache, dict):
        geocache = {}
    if not addr or not addr.strip():
        logger.warning("Предоставлен пустой адрес")
        return (None, None)

    addr = addr.strip()

    # Сначала проверить кэш
    if addr in geocache:
        cached_coords = geocache[addr]
        if cached_coords != [None, None]:
            lat, lon = cached_coords
            # Проверить диапазон Калининграда (примерно 54-55 lat, 19-21 lon)
            if 54 <= lat <= 55 and 19 <= lon <= 21:
                logger.info(f"[CACHE    ] HIT | {addr} → {lat:.6f},{lon:.6f}")
                return tuple(cached_coords)
            else:
                # Invalid coords, delete from cache and re-geocode
                logger.warning(f"[CACHE    ] INVALID | {addr} → {lat:.6f},{lon:.6f}, удаляю и re-гекодинг")
                del geocache[addr]
            logger.info(f"[CACHE    ] HIT | {addr} → координаты не найдены")

    # Добавить город, если не указан
    loc_query = addr
    if not re.search(CITY_WORDS, addr, re.I):
        loc_query += ", Калининград"
    # Попытаться использовать сервисы геокодинга
    for provider in GEOCODERS:
        name, func = provider["name"], provider["func"]
        if not func:
            log_geocoding(addr, name, False, "key not configured")
            continue

        try:
            loc = func(loc_query)
            if loc:
                coords = [loc.latitude, loc.longitude]
                geocache[addr] = coords
                log_geocoding(addr, name, True, f"{coords[0]:.6f},{coords[1]:.6f}")
                return tuple(coords)
            else:
                log_geocoding(addr, name, False, "no result")
        except requests.exceptions.RequestException as e:
            log_geocoding(addr, name, False, f"HTTP error: {e}")
        except geopy.exc.GeopyError as e:
            log_geocoding(addr, name, False, f"Geocoding error: {e}")
        except Exception as e:
            log_geocoding(addr, name, False, f"Unexpected error: {e}")

    # Все геокодеры не удались
    geocache[addr] = [None, None]
    logger.warning(f"Все геокодеры не удались для: {addr}")
    return (None, None)

def load_sheets_data(url: str) -> pd.DataFrame:
    """Загрузить данные из Google Sheets в виде DataFrame."""
    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
        # Декодировать с учетом возможной кодировки
        csv_content = response.content.decode('utf-8-sig')  # utf-8-sig for BOM
        df = pd.read_csv(StringIO(csv_content))
        logger.info(f"Загружено {len(df)} строк из Google Sheets")
        return df
    except Exception as e:
        logger.error(f"Не удалось загрузить данные из Google Sheets: {e}")
        sys.exit(1)

def normalize_event_row(row):
    """Нормализовать строку события из DataFrame."""
    # All columns are pulled, position based mapping from CSV example: 0:empty, 1:date, 2:title, 3:location, 4:time, 5:tags, 6:short, 7:full, 8:contacts, 9:age
    col_names = list(row.index)

    event = {}
    if len(col_names) > 1:
        event['date'] = str(row[col_names[1]]) if pd.notna(row[col_names[1]]) else ''
    if len(col_names) > 2:
        event['title'] = str(row[col_names[2]]) if pd.notna(row[col_names[2]]) else ''
    if len(col_names) > 3:
        event['location'] = str(row[col_names[3]]) if pd.notna(row[col_names[3]]) else ''
    if len(col_names) > 4:
        event['time'] = str(row[col_names[4]]) if pd.notna(row[col_names[4]]) else ''
    if len(col_names) > 5:
        event['tags'] = str(row[col_names[5]]) if pd.notna(row[col_names[5]]) else ''
    if len(col_names) > 6:
        event['short_description'] = str(row[col_names[6]]) if pd.notna(row[col_names[6]]) else ''
    if len(col_names) > 7:
        event['full_description'] = str(row[col_names[7]]) if pd.notna(row[col_names[7]]) else ''
    if len(col_names) > 8:
        event['contacts'] = str(row[col_names[8]]) if pd.notna(row[col_names[8]]) else ''

    # Проверка обязательных полей
    if not event.get('date') or not event.get('title') or not event.get('location'):
        logger.warning(f"Пропуск строки: отсутствуют обязательные поля: date='{event.get('date')}', title='{event.get('title')}', location='{event.get('location')}'")
        return None

    # Нормализация адреса: удаление кавычек и лишних пробелов
    event['location'] = event['location'].strip('"').strip()

    # Геокодинг
    lat, lon = geocode_addr(event['location'])
    if lat is not None and lon is not None:
        event['lat'] = lat
        event['lon'] = lon
    else:
        logger.warning(f"Не удалось геокодировать: {event['location']}, пропуск события")
        return None

    return event

def main():
    """Основной обработчик с полной обработкой ошибок."""
    logger.info("Запуск обработки событий из Google Sheets...")

    try:
        # Загрузить кэш
        global geocache, original_cache, geolog
        geocache = load_cache()
        original_cache = geocache.copy()
        geolog = {}

        # Загрузить существующие события
        existing_events_dict = {}
        if OUTPUT_JSON.exists():
            try:
                existing_events = json.loads(OUTPUT_JSON.read_text(encoding='utf-8'))
                existing_events_dict = {f"{e['date']}|{e['title']}|{e['location']}|{e.get('time', '')}": e for e in existing_events}
                logger.info(f"Загружено {len(existing_events_dict)} существующих событий")
            except Exception as e:
                logger.warning(f"Не удалось загрузить существующие события: {e}")

        # Загрузить данные из Google Sheets
        df = load_sheets_data(GOOGLE_SHEETS_URL)

        # Нормализовать и фильтровать события, обновлять существующие или добавлять новые
        updated_count = 0
        added_count = 0
        for idx, row in df.iterrows():
            if idx <= 2:  # Пропустить первые две строки (шаблон/пример)
                continue
            # Полная нормализация с geocoding
            event = normalize_event_row(row)
            if event:
                event_key = f"{event['date']}|{event['title']}|{event['location']}|{event.get('time', '')}"
                if event_key in existing_events_dict:
                    existing_events_dict[event_key].update(event)
                    logger.debug(f"Обновлено событие: {event['title']}")
                    updated_count += 1
                else:
                    existing_events_dict[event_key] = event
                    logger.info(f"Добавлено новое событие: {event['title']}")
                    added_count += 1

        logger.info(f"Обработано: {updated_count} обновлений, {added_count} добавлений")

        if not existing_events_dict:
            logger.warning("События не найдены")
            return

        # Получить список событий
        all_events = list(existing_events_dict.values())

        logger.info(f"Общий датасет: {len(all_events)} событий")

        # Сортировать по дате
        all_events.sort(key=lambda x: x['date'])

        # Сохранить результат
        logger.info(f"Начинаем сохранение {len(all_events)} событий в {OUTPUT_JSON}")
        try:
            json_str = json.dumps(all_events, ensure_ascii=False, indent=2)
            logger.info(f"Сгенерирован JSON размером {len(json_str)} символов")
            OUTPUT_JSON.write_text(json_str, encoding="utf-8")
            logger.info(f"Успешно сохранено в {OUTPUT_JSON}. Файл существует: {OUTPUT_JSON.exists()}")
            if OUTPUT_JSON.exists():
                file_size = OUTPUT_JSON.stat().st_size if hasattr(OUTPUT_JSON, 'stat') else 0
                logger.info(f"Размер файла: {file_size} байт")
        except Exception as e:
            logger.error(f"Не удалось сохранить в {OUTPUT_JSON}: {e}")
            raise

        # Сохранить кэш
        save_cache(geocache)

        # Сохранить детальный лог если включено
        if GEOCODE_SAVE_LOG and geolog:
            try:
                LOG_FILE.write_text(json.dumps(geolog, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception as e:
                logger.error(f"Не удалось сохранить лог геокодинга: {e}")

        logger.info("Обработка событий завершена успешно")

    except Exception as e:
        logger.critical(f"Критическая ошибка в main: {e}", exc_info=True)
        sys.exit(1)
    finally:
        # Всегда закрывать сессию
        session.close()
        logger.info("Сессия закрыта")

if __name__ == "__main__":
    main()
