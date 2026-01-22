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
import hashlib
from pathlib import Path
from io import StringIO
from typing import Dict, List, Tuple, Optional, Any, Union

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
SHEETS_CACHE_FILE = Path("sheets_cache.json")

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

def log_geocoding(addr: str, provider: str, success: bool, detail: str = "") -> None:
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

def load_cache() -> Dict[str, List[Optional[float]]]:
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

def save_cache(cache: Dict[str, List[Optional[float]]], force: bool = False) -> None:
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

def geocode_addr(addr: str) -> Tuple[Optional[float], Optional[float]]:
    """Каскадный геокодинг с обработкой ошибок."""
    global geocache
    if not isinstance(geocache, dict):
        geocache = {}
    if not addr or not addr.strip():
        logger.warning("Предоставлен пустой адрес")
        return (None, None)

    addr = addr.strip()

    # Сначала проверить кэш (приоритет ручным правкам)
    if addr in geocache:
        cached_coords = geocache[addr]
        if cached_coords != [None, None]:
            lat, lon = cached_coords
            logger.info(f"[CACHE    ] HIT | {addr} → {lat:.6f},{lon:.6f}")
            return tuple(cached_coords)
        else:
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

def load_sheets_data(url: str) -> Optional[pd.DataFrame]:
    """Загрузить данные из Google Sheets в виде DataFrame с кэшированием."""
    try:
        response = session.get(url, timeout=30)
        response.raise_for_status()
        # Декодировать с учетом возможной кодировки
        csv_content = response.content.decode('utf-8-sig')  # utf-8-sig for BOM

        # Вычислить хэш контента
        current_hash = hashlib.md5(csv_content.encode('utf-8')).hexdigest()

        # Проверить кэш
        sheets_cache = {}
        if SHEETS_CACHE_FILE.exists():
            try:
                sheets_cache = json.loads(SHEETS_CACHE_FILE.read_text(encoding='utf-8'))
            except Exception:
                pass

        if sheets_cache.get('hash') == current_hash:
            logger.info("Данные Sheets не изменились, используем кэш")
            return None

        # Обновить кэш
        sheets_cache['hash'] = current_hash
        sheets_cache['timestamp'] = time.time()
        try:
            SHEETS_CACHE_FILE.write_text(json.dumps(sheets_cache, indent=2), encoding='utf-8')
        except Exception as e:
            logger.warning(f"Не удалось сохранить кэш Sheets: {e}")

        df = pd.read_csv(StringIO(csv_content))
        logger.info(f"Загружено {len(df)} строк из Google Sheets")
        return df
    except Exception as e:
        logger.error(f"Не удалось загрузить данные из Google Sheets: {e}")
        sys.exit(1)

def make_event_id(event: Dict[str, Any]) -> str:
    """Генерировать уникальный ID события на основе его данных."""
    source = f"{event['date']}|{event['title']}|{event.get('lat', '')}|{event.get('lon', '')}"
    hash_val = 5381
    for char in source:
        hash_val = ((hash_val << 5) + hash_val) + ord(char)
    return f"e{hash_val & 0x7FFFFFFF:08x}"

def parse_event_dates(date_str: Optional[str]) -> List[str]:
    """Парсить строку дат и вернуть список отдельных дат.

    Поддерживает форматы:
    - Одиночная дата: "15.01"
    - Интервал: "15.01-20.01" или "15-20.01" -> ["15.01", "16.01", ..., "20.01"]
    - Несколько дат: "15.01, 17.01, 19.01" -> ["15.01", "17.01", "19.01"]
    - Смешанный: "15.01-17.01, 19.01" -> ["15.01", "16.01", "17.01", "19.01"]
    """
    if not date_str:
        return []

    # Разделить по запятым, точке с запятой и/или пробелам, но сохраняем части типа 15-20.01
    parts = [p.strip() for p in re.split(r'[;,]+|(?<!\d)-(?!\d)|\s+', date_str) if p.strip()]

    result = []

    for part in parts:
        # Проверить на интервал формата DD.MM-DD.MM
        range_match = re.match(r'^(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})$', part)
        if range_match:
            start_day = int(range_match.group(1))
            start_month = int(range_match.group(2))
            end_day = int(range_match.group(3))
            end_month = int(range_match.group(4))

            if start_month != end_month:
                logger.warning(f"Интервал через разные месяцы не поддерживается: {part}")
                continue

            for day in range(start_day, end_day + 1):
                result.append(f"{day:02d}.{start_month:02d}")
            continue

        # Интервал вида DD-DD.MM (например "15-20.01")
        range_match2 = re.match(r'^(\d{1,2})-(\d{1,2})\.(\d{2})$', part)
        if range_match2:
            start_day = int(range_match2.group(1))
            end_day = int(range_match2.group(2))
            month = int(range_match2.group(3))

            for day in range(start_day, end_day + 1):
                result.append(f"{day:02d}.{month:02d}")
            continue

        # Одиночная дата DD.MM
        single_match = re.match(r'^(\d{1,2})\.(\d{2})$', part)
        if single_match:
            result.append(part)
            continue

        # Попробуем найти даты внутри строки (например, разделённые запятой)
        sub_dates = re.findall(r'(\d{1,2}\.\d{2})', part)
        if sub_dates:
            result.extend(sub_dates)
            continue

        logger.warning(f"Неверный формат даты: {part}")

    # Удалить дубликаты, сохранить порядок
    seen = set()
    unique = []
    for d in result:
        if d not in seen:
            seen.add(d)
            unique.append(d)

    return unique


def generate_stable_id(date: Any, title: Any, location: Any) -> str:
    """Генерировать стабильный ID на основе даты, названия и места."""
    # Очистить и нормализовать данные
    clean_date = str(date).strip() if date else ""
    clean_title = str(title).strip() if title else ""
    clean_location = str(location).strip() if location else ""

    # Создать источник для хэширования
    source = f"{clean_date}|{clean_title}|{clean_location}"

    # Простой хэш-функция (DJB2)
    hash_val = 5381
    for char in source:
        hash_val = ((hash_val << 5) + hash_val) + ord(char)

    # Возвращаем 8-значный hex ID
    return f"{hash_val & 0x7FFFFFFF:08x}"

def normalize_event_row(row: pd.Series, row_index: int) -> Optional[Dict[str, Any]]:
    """Нормализовать строку события из DataFrame.

    ID генерируется по номеру в колонке A, с дробными для множественных дат.
    """
    col_names = list(row.index)

    event = {}
    # ID читаем из столбца A (индекс 0) как base_id
    base_id = ''
    if len(col_names) > 0:
        raw_val = row[col_names[0]]
        if pd.notna(raw_val):
            raw_id = str(raw_val).strip()
            # Преобразовать числа вида 66.0 -> 66
            m_num = re.match(r'^\s*(\d+)(?:\.0+)?\s*$', raw_id)
            if m_num:
                base_id = m_num.group(1)
            else:
                # Некорректный формат — генерируем стабильный ID
                temp_date = str(row[col_names[1]]) if len(col_names) > 1 and pd.notna(row[col_names[1]]) else ''
                temp_title = str(row[col_names[2]]) if len(col_names) > 2 and pd.notna(row[col_names[2]]) else ''
                temp_location = str(row[col_names[3]]) if len(col_names) > 3 and pd.notna(row[col_names[3]]) else ''
                base_id = generate_stable_id(temp_date, temp_title, temp_location)
                logger.info(f"Некорректный base_id '{raw_id}' заменен на стабильный: {base_id}")
        else:
            # Отсутствует base_id — генерируем стабильный ID
            temp_date = str(row[col_names[1]]) if len(col_names) > 1 and pd.notna(row[col_names[1]]) else ''
            temp_title = str(row[col_names[2]]) if len(col_names) > 2 and pd.notna(row[col_names[2]]) else ''
            temp_location = str(row[col_names[3]]) if len(col_names) > 3 and pd.notna(row[col_names[3]]) else ''
            base_id = generate_stable_id(temp_date, temp_title, temp_location)
            logger.info(f"Отсутствует base_id, присвоен стабильный: {base_id}")
    else:
        # Нет столбца A — генерируем стабильный ID (fallback)
        base_id = generate_stable_id('', '', '')
        logger.info(f"Нет столбца A, присвоен fallback base_id: {base_id}")

    event['_base_id'] = base_id

    # Остальные поля
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
    if not event.get('_base_id'):
        logger.warning(f"Пропуск строки: отсутствует base_id для события (строка индекс неизвестен)")
        return None
    if not event.get('date') or not event.get('title') or not event.get('location'):
        logger.warning(f"Пропуск строки: отсутствуют обязательные поля: base_id='{event.get('_base_id')}', date='{event.get('date')}', title='{event.get('title')}', location='{event.get('location')}'")
        return None

    # Нормализация адреса: удаление кавычек и лишних пробелов
    event['location'] = event['location'].strip('"').strip()

    # Геокодинг
    lat, lon = geocode_addr(event['location'])
    if lat is not None and lon is not None:
        event['lat'] = lat
        event['lon'] = lon
    else:
        logger.warning(f"Не удалось геокодировать: {event['location']}, пропуск события id={event.get('id')}")
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

        # Загрузить существующие события по id
        existing_events_dict = {}
        if OUTPUT_JSON.exists():
            try:
                existing_events = json.loads(OUTPUT_JSON.read_text(encoding='utf-8'))
                for event in existing_events:
                    # Добавить id, если отсутствует (для совместимости со старым форматом)
                    if 'id' not in event or not event['id']:
                        event['id'] = make_event_id(event)
                        logger.info(f"Добавлен id для существующего события: {event['id']}")
                    existing_events_dict[event['id']] = event
                logger.info(f"Загружено {len(existing_events_dict)} существующих событий")
            except Exception as e:
                logger.warning(f"Не удалось загрузить существующие события: {e}")

        # Загрузить данные из Google Sheets
        df = load_sheets_data(GOOGLE_SHEETS_URL)
        if df is None:
            logger.info("Данные Sheets не изменились, пропускаем обработку событий")
            # Сохранить кэш если нужно
            save_cache(geocache)
            return

        # Обработать данные из таблицы: создать события на каждый день интервала
        temp_events = []
        skipped_rows = 0
        processed_rows = 0

        for idx, row in df.iterrows():
            # Автоматически определить начало данных: пропустить строки без даты и названия
            col_names = list(row.index)
            if len(col_names) >= 3:
                date_val = str(row[col_names[1]]) if pd.notna(row[col_names[1]]) else ''
                title_val = str(row[col_names[2]]) if pd.notna(row[col_names[2]]) else ''
                location_val = str(row[col_names[3]]) if len(col_names) > 3 and pd.notna(row[col_names[3]]) else ''

                # Пропустить строку если нет основных данных (дата, название, место)
                if not date_val.strip() or not title_val.strip() or not location_val.strip():
                    logger.debug(f"Пропущена строка {idx + 1}: отсутствуют основные данные")
                    continue
            else:
                # Мало колонок - пропустить
                logger.debug(f"Пропущена строка {idx + 1}: недостаточно колонок")
                continue

            # Нормализовать базовое событие (idx - 2 для учета пропущенных строк)
            base_event = normalize_event_row(row, idx - 2)
            if not base_event:
                skipped_rows += 1
                continue

            # Парсить даты (интервалы и множественные даты)
            dates = parse_event_dates(base_event['date'])
            if not dates:
                logger.warning(f"Не удалось распарсить даты для события {base_event['id']}: {base_event['date']}")
                skipped_rows += 1
                continue

            # Создать событие на каждый день
            base_id = base_event['_base_id']
            for i, single_date in enumerate(dates, 1):
                event = base_event.copy()
                event['date'] = single_date
                event['_sort_key'] = f"{single_date}|{event['title']}|{event['location']}"  # Ключ для сортировки

                # Временно присвоить ID: base_id из колонки A, дробные для множественных дат
                if len(dates) == 1:
                    event['_temp_id'] = base_id
                else:
                    event['_temp_id'] = f"{base_id}.{i}"

                temp_events.append(event)
                logger.debug(f"Создано событие: temp_id={event['_temp_id']}, date={event['date']}, title={event['title']}")

            processed_rows += 1

        # Сортировать все события по дате проведения
        temp_events.sort(key=lambda x: x['date'])

        # Присвоить ID из _temp_id всем событиям
        new_events_dict = {}
        for event in temp_events:
            event['id'] = event['_temp_id']

            # Очистить временные поля
            del event['_sort_key']
            del event['_temp_id']

            new_events_dict[event['id']] = event
            logger.info(f"Присвоен ID: {event['id']} для '{event['title']}' на {event['date']}")

        logger.info(f"Обработано строк таблицы: {processed_rows}, пропущено: {skipped_rows}")

        # Синхронизировать: обновить существующие, добавить новые, удалить отсутствующие
        updated_count = 0
        added_count = 0
        deleted_count = 0

        # Обновить и добавить
        for event_id, event in new_events_dict.items():
            if event_id in existing_events_dict:
                # Обновить атрибуты
                existing_events_dict[event_id].update(event)
                logger.info(f"Обновлено событие: id={event_id}, title={event['title']}")
                updated_count += 1
            else:
                # Добавить новое
                existing_events_dict[event_id] = event
                logger.info(f"Добавлено новое событие: id={event_id}, title={event['title']}")
                added_count += 1

        # Удалить события, которых нет в таблице
        ids_to_delete = [eid for eid in existing_events_dict.keys() if eid not in new_events_dict]
        for event_id in ids_to_delete:
            del existing_events_dict[event_id]
            logger.info(f"Удалено событие: id={event_id}")
            deleted_count += 1

        logger.info(f"Синхронизация завершена: обновлено {updated_count}, добавлено {added_count}, удалено {deleted_count}")

        if not existing_events_dict:
            logger.warning("События не найдены")
            return

        # Получить список событий
        all_events = list(existing_events_dict.values())

        logger.info(f"Общий датасет: {len(all_events)} событий")

        # Сортировать по дате
        all_events.sort(key=lambda x: x['date'])

        # Сохранить результат только если были изменения
        if updated_count > 0 or added_count > 0 or deleted_count > 0:
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
        else:
            logger.info("Изменений в событиях нет, пропускаем сохранение events.json")

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
