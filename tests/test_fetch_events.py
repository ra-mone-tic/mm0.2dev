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

from fetch_events import load_cache, save_cache, geocode_addr


class TestDateParsing:
    """Тесты для функций парсинга дат."""

    def test_parse_event_dates_single_date(self):
        """Тест парсинга одиночной даты."""
        from fetch_events import parse_event_dates
        result = parse_event_dates("15.01")
        assert result == ["15.01"]

    def test_parse_event_dates_range(self):
        """Тест парсинга диапазона дат."""
        from fetch_events import parse_event_dates
        result = parse_event_dates("15-17.01")
        assert result == ["15.01", "16.01", "17.01"]

    def test_parse_event_dates_multiple(self):
        """Тест парсинга нескольких дат."""
        from fetch_events import parse_event_dates
        result = parse_event_dates("15.01, 17.01")
        assert result == ["15.01", "17.01"]


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
