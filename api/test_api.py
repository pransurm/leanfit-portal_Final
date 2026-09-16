import pytest
from datetime import date, timedelta
from api.calculations import (
    calc_adherence,
    calc_streak,
    classify_traffic_light,
    get_client_alerts,
    calc_body_fat,
    parse_date_dmy,
    format_date_dmy
)

def test_date_formatting():
    d = date(2026, 9, 8)
    formatted = format_date_dmy(d)
    assert formatted == "08-09-2026"

    parsed = parse_date_dmy("08-09-2026")
    assert parsed == d

def test_adherence_calculation():
    # 7 perfect checkins
    checkins = [
        {"meals": 5, "steps": 8000, "water": 3.0, "multi": True}
        for _ in range(7)
    ]
    adh = calc_adherence(checkins, steps_goal=8000)
    assert adh["overall"] == 100
    assert adh["meals"] == 100
    assert adh["steps"] == 100
    assert adh["water"] == 100
    assert adh["vitamins"] == 100

    # Half adherence
    checkins_half = [
        {"meals": 2.5, "steps": 4000, "water": 1.5, "multi": False}
    ]
    adh_half = calc_adherence(checkins_half, steps_goal=8000)
    # Meals: 50% * 0.4 = 20, Steps: 50% * 0.3 = 15, Water: 50% * 0.2 = 10, Multi: 0% * 0.1 = 0 -> 45
    assert adh_half["overall"] == 45

def test_streak_calculation():
    today = date(2026, 9, 10)
    dates = [
        date(2026, 9, 10),
        date(2026, 9, 9),
        date(2026, 9, 8),
        date(2026, 9, 7),
    ]
    streak, days_since, checked_in = calc_streak(dates, today=today)
    assert streak == 4
    assert days_since == 0
    assert checked_in is True

    # Missed today, checked in yesterday
    dates_yesterday = [
        date(2026, 9, 9),
        date(2026, 9, 8),
    ]
    streak2, days_since2, checked_in2 = calc_streak(dates_yesterday, today=today)
    assert streak2 == 2
    assert days_since2 == 1
    assert checked_in2 is False

    # Broken streak (last checkin 3 days ago)
    dates_broken = [
        date(2026, 9, 7),
    ]
    streak3, days_since3, checked_in3 = calc_streak(dates_broken, today=today)
    assert streak3 == 0
    assert days_since3 == 3
    assert checked_in3 is False

def test_traffic_light_classification():
    # Green client: consistent, high adherence, active streak
    green_client = {
        "status": "active",
        "daysSince": 0,
        "streak": 7,
        "adherence": {"overall": 88}
    }
    assert classify_traffic_light(green_client) == "g"

    # Yellow client: 1 day missed or adherence between 45 and 74
    yellow_client = {
        "status": "active",
        "daysSince": 1,
        "streak": 3,
        "adherence": {"overall": 70}
    }
    assert classify_traffic_light(yellow_client) == "am"

    # Red client: >= 3 days inactive or adherence < 45
    red_client = {
        "status": "active",
        "daysSince": 3,
        "streak": 0,
        "adherence": {"overall": 35}
    }
    assert classify_traffic_light(red_client) == "r"

    # Paused client: amber
    paused_client = {
        "status": "paused",
        "daysSince": 5,
        "streak": 0,
        "adherence": {"overall": 60}
    }
    assert classify_traffic_light(paused_client) == "am"

def test_body_fat_calculation():
    # Waist 86.5 cm, Neck 36.5 cm, Height 175 cm -> 19.3%
    bf = calc_body_fat(waist_cm=86.5, neck_cm=36.5, height_cm=175.0)
    assert bf is not None
    assert bf == 19.3

    # Invalid measurements (waist <= neck)
    bf_invalid = calc_body_fat(waist_cm=35.0, neck_cm=36.0, height_cm=175.0)
    assert bf_invalid is None
