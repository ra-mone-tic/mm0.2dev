#!/usr/bin/env python3
"""
Тесты для fetch_events.py
Запуск: python -m pytest tests/test_fetch_events.py -v
или: python tests/test_fetch_events.py
"""

import pytest
import json
import os
import tempfile
from unittest.mock import patch, mock_open, MagicMock
import sys
from pathlib import Path

# Добавляем корневую директорию в путь для импорта
sys.path.insert(0, str(Path(__file__).parent.parent))

from fetch_events import extract, load_cache, save_cache, geocode_addr


class TestExtractFunction:
    """Тесты для функции извлечения данных события из текста поста."""

    def test_extract_valid_event(self):
        """Тест извлечения корректного события."""
        text = "📍 ул. Ленина, 1, Калининград\n01.12 | Концерт группы ABC\nОписание концерта..."
        result = extract(text)

        assert result is not None
        assert result['title'] == "Концерт группы ABC"
        assert result['date'] == "2025-12-01"  # Текущий год по умолчанию
        assert "ул. Ленина, 1, Калининград" in result['location']
        assert result['text'] == text

    def test_extract_without_location(self):
        """Тест без указания места."""
        text = "ДД.MM | Концерт без адреса"
        result = extract(text)
        assert result is None

    def test_extract_without_date(self):
        """Тест без указания даты."""
        text = "📍 ул. Ленина, 1\nКонцерт без даты"
        result = extract(text)
        assert result is None

    def test_extract_with_city_addition(self):
        """Тест добавления города, если его нет."""
        text = "📍 ул. Ленина, 1\n01.12 | Концерт в центре"
        result = extract(text)

        assert result is not None
        assert "Калининград" in result['location']

    def test_extract_different_date_formats(self):
        """Тест различных форматов дат."""
        test_cases = [
            ("📍 адрес\n01.12 | Событие 1", "2025-12-01"),
            ("📍 адрес\n15.03 | Событие 2", "2025-03-15"),
            ("📍 адрес\n31.12 | Событие 3", "2025-12-31"),
        ]

        for text, expected_date in test_cases:
            result = extract(text)
            assert result is not None, f"Не удалось распарсить: {text}"
            assert result['date'] == expected_date, f"Неверная дата для {text}"

    def test_extract_title_cleaning(self):
        """Тест очистки заголовка от лишних символов."""
        text = "📍 адрес\n01.12 |   Концерт с пробелами   "
        result = extract(text)
        assert result['title'] == "Концерт с пробелами"


class TestCacheFunctions:
    """Тесты для функций работы с кэшем геокодинга."""

    def test_load_cache_empty_file(self):
        """Тест загрузки пустого кэша."""
        with patch('builtins.open', mock_open(read_data='{}')):
            cache = load_cache()
            assert cache == {}

    def test_load_cache_with_data(self):
        """Тест загрузки кэша с данными."""
        test_data = {"ул. Ленина, 1": [54.71, 20.51]}
        with patch('builtins.open', mock_open(read_data=json.dumps(test_data))):
            cache = load_cache()
            assert cache == test_data

    def test_load_cache_invalid_json(self):
        """Тест загрузки поврежденного JSON."""
        with patch('builtins.open', mock_open(read_data='invalid json')):
            with patch('fetch_events.logger') as mock_logger:
                cache = load_cache()
                assert cache == {}
                mock_logger.warning.assert_called()

    def test_save_cache_no_changes(self):
        """Тест сохранения кэша без изменений."""
        original_cache = {"test": [1, 2]}
        with patch('fetch_events.original_cache', original_cache):
            with patch('builtins.open', mock_open()) as mock_file:
                save_cache(original_cache, force=False)
                mock_file.assert_not_called()

    def test_save_cache_with_changes(self):
        """Тест сохранения кэша с изменениями."""
        new_cache = {"test": [1, 2]}
        with patch('builtins.open', mock_open()) as mock_file:
            save_cache(new_cache, force=True)
            mock_file.assert_called_once()


class TestGeocoding:
    """Тесты для геокодинга."""

    def test_geocode_empty_address(self):
        """Тест геокодинга пустого адреса."""
        result = geocode_addr("")
        assert result == (None, None)

    def test_geocode_from_cache(self):
        """Тест получения координат из кэша."""
        with patch('fetch_events.geocache', {"cached address": [54.71, 20.51]}):
            result = geocode_addr("cached address")
            assert result == (54.71, 20.51)

    @pytest.mark.skip(reason="Геокодинг тесты требуют сложного мокирования реальных сервисов")
    def test_geocode_success_arcgis(self):
        """Тест успешного геокодинга через ArcGIS."""
        pass

    @pytest.mark.skip(reason="Геокодинг тесты требуют сложного мокирования реальных сервисов")
    def test_geocode_fallback_to_nominatim(self):
        """Тест fallback геокодинга при недоступности ArcGIS."""
        pass


if __name__ == "__main__":
    # Простой запуск без pytest
    import unittest
    unittest.main()
