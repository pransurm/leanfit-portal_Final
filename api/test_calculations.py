import unittest
from datetime import date
from api.calculations import (
    calc_adherence,
    calc_streak,
    classify_traffic_light,
    get_client_alerts,
    calc_body_fat,
    parse_date_dmy,
    format_date_dmy
)

class TestCalculations(unittest.TestCase):

    def test_date_formatting(self):
        d = date(2026, 9, 8)
        formatted = format_date_dmy(d)
        self.assertEqual(formatted, "08-09-2026")

        parsed = parse_date_dmy("08-09-2026")
        self.assertEqual(parsed, d)

    def test_adherence_calculation(self):
        # 7 perfect checkins
        checkins = [
            {"meals": 5, "steps": 8000, "water": 3.0, "multi": True}
            for _ in range(7)
        ]
        adh = calc_adherence(checkins, steps_goal=8000)
        self.assertEqual(adh["overall"], 100)
        self.assertEqual(adh["meals"], 100)
        self.assertEqual(adh["steps"], 100)
        self.assertEqual(adh["water"], 100)
        self.assertEqual(adh["vitamins"], 100)

        # Half adherence
        checkins_half = [
            {"meals": 2.5, "steps": 4000, "water": 1.5, "multi": False}
        ]
        adh_half = calc_adherence(checkins_half, steps_goal=8000)
        self.assertEqual(adh_half["overall"], 45)

    def test_streak_calculation(self):
        today = date(2026, 9, 10)
        dates = [
            date(2026, 9, 10),
            date(2026, 9, 9),
            date(2026, 9, 8),
            date(2026, 9, 7),
        ]
        streak, days_since, checked_in = calc_streak(dates, today=today)
        self.assertEqual(streak, 4)
        self.assertEqual(days_since, 0)
        self.assertTrue(checked_in)

        # Missed today, checked in yesterday
        dates_yesterday = [
            date(2026, 9, 9),
            date(2026, 9, 8),
        ]
        streak2, days_since2, checked_in2 = calc_streak(dates_yesterday, today=today)
        self.assertEqual(streak2, 2)
        self.assertEqual(days_since2, 1)
        self.assertFalse(checked_in2)

        # Broken streak (last checkin 3 days ago)
        dates_broken = [
            date(2026, 9, 7),
        ]
        streak3, days_since3, checked_in3 = calc_streak(dates_broken, today=today)
        self.assertEqual(streak3, 0)
        self.assertEqual(days_since3, 3)
        self.assertFalse(checked_in3)

    def test_traffic_light_classification(self):
        # Green client: consistent, high adherence, active streak
        green_client = {
            "status": "active",
            "daysSince": 0,
            "streak": 7,
            "adherence": {"overall": 88}
        }
        self.assertEqual(classify_traffic_light(green_client), "g")

        # Yellow client: 1 day missed or adherence between 45 and 74
        yellow_client = {
            "status": "active",
            "daysSince": 1,
            "streak": 3,
            "adherence": {"overall": 70}
        }
        self.assertEqual(classify_traffic_light(yellow_client), "am")

        # Red client: >= 3 days inactive or adherence < 45
        red_client = {
            "status": "active",
            "daysSince": 3,
            "streak": 0,
            "adherence": {"overall": 35}
        }
        self.assertEqual(classify_traffic_light(red_client), "r")

        # Paused client: amber
        paused_client = {
            "status": "paused",
            "daysSince": 5,
            "streak": 0,
            "adherence": {"overall": 60}
        }
        self.assertEqual(classify_traffic_light(paused_client), "am")

    def test_body_fat_calculation(self):
        # Waist 86.5 cm, Neck 36.5 cm, Height 175 cm -> 19.3%
        bf = calc_body_fat(waist_cm=86.5, neck_cm=36.5, height_cm=175.0)
        self.assertIsNotNone(bf)
        self.assertEqual(bf, 19.3)

        # Invalid measurements (waist <= neck)
        bf_invalid = calc_body_fat(waist_cm=35.0, neck_cm=36.0, height_cm=175.0)
        self.assertIsNone(bf_invalid)

if __name__ == "__main__":
    unittest.main()
