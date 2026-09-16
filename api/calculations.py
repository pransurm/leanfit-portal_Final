import math
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional

def parse_date_dmy(date_str: str) -> Optional[date]:
    """Parse DD-MM-YYYY format into date object. Falls back to YYYY-MM-DD if needed."""
    if not date_str:
        return None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str.strip(), fmt).date()
        except ValueError:
            continue
    return None

def format_date_dmy(d: date) -> str:
    """Format date to standardized DD-MM-YYYY."""
    return d.strftime("%d-%m-%Y")

def calc_adherence(checkins: List[Dict[str, Any]], steps_goal: int = 8000) -> Dict[str, int]:
    """
    Weighted + Proportional Adherence calculation:
    Meals 40% (proportional: meals/5 * 100)
    Steps 30% (proportional: min(100, steps/steps_goal * 100))
    Hydration 20% (proportional: min(100, water/3.0 * 100))
    Vitamins 10% (100 if multi else 0)
    """
    if not checkins:
        return {"meals": 0, "steps": 0, "water": 0, "vitamins": 0, "overall": 0}

    def avg(arr: List[float]) -> float:
        return sum(arr) / len(arr) if arr else 0.0

    meal_scores = [(min(5, max(0, c.get("meals", 0))) / 5.0) * 100.0 for c in checkins]
    step_scores = [min(100.0, (max(0, c.get("steps", 0)) / max(1, steps_goal)) * 100.0) for c in checkins]
    water_scores = [min(100.0, (max(0, float(c.get("water", 0.0))) / 3.0) * 100.0) for c in checkins]
    vit_scores = [100.0 if c.get("multi", False) else 0.0 for c in checkins]

    meals = round(avg(meal_scores))
    steps = round(avg(step_scores))
    water = round(avg(water_scores))
    vitamins = round(avg(vit_scores))

    overall = round(meals * 0.4 + steps * 0.3 + water * 0.2 + vitamins * 0.1)
    return {
        "meals": meals,
        "steps": steps,
        "water": water,
        "vitamins": vitamins,
        "overall": overall
    }

def calc_streak(checkin_dates: List[date], today: Optional[date] = None) -> tuple[int, int, bool]:
    """
    Calculates:
    - streak: consecutive days checked in ending today or yesterday
    - days_since: days since the last check-in
    - checked_in_today: True if there is a check-in on today's date
    """
    if today is None:
        today = date.today()

    if not checkin_dates:
        return 0, 999, False

    unique_sorted = sorted(set(checkin_dates), reverse=True)
    latest_date = unique_sorted[0]

    days_since = (today - latest_date).days
    checked_in_today = (days_since == 0)

    # If the latest check-in is more than 1 day ago (e.g. 2 days ago), streak is broken
    if days_since > 1:
        return 0, days_since, checked_in_today

    # Count consecutive streak days
    streak = 0
    expected_date = latest_date
    for d in unique_sorted:
        if d == expected_date:
            streak += 1
            expected_date -= timedelta(days=1)
        else:
            break

    return streak, days_since, checked_in_today

def classify_traffic_light(client_data: Dict[str, Any]) -> str:
    """
    User-approved traffic light rules:
    - 🟢 Green: consistently checking in, steady progress, adherence >= 75%, positive momentum.
    - 🟡 Yellow: fewer check-ins, progress not up to the mark (1-2 days missed, adherence 45%-74%, streak < 4).
    - 🔴 Red: not checking in at all or very rarely, inactive (days_since >= 3, adherence < 45%, streak == 0).
    - Status 'paused': 'am' (Yellow/Hold status)
    """
    status = client_data.get("status", "active")
    if status == "paused":
        return "am"

    days_since = client_data.get("daysSince", 0)
    streak = client_data.get("streak", 0)
    adherence = client_data.get("adherence", {})
    overall_adh = adherence.get("overall", 0) if isinstance(adherence, dict) else int(adherence or 0)

    if days_since >= 3 or streak == 0 or overall_adh < 45:
        return "r"
    if days_since >= 1 or overall_adh < 75 or streak < 4:
        return "am"
    return "g"

def get_client_alerts(client_data: Dict[str, Any], coach_steps_goal: int = 8000) -> List[Dict[str, str]]:
    alerts = []
    status = client_data.get("status", "active")
    days_since = client_data.get("daysSince", 0)
    checked_in = client_data.get("checkedIn", False)
    latest_meals = client_data.get("latestMeals", 5)
    latest_steps = client_data.get("latestSteps", coach_steps_goal)
    latest_stress = client_data.get("latestStress", 1)
    latest_water = client_data.get("latestWater", 3.0)

    if status == "paused":
        alerts.append({"lvl": "am", "msg": "Programme paused"})
    elif days_since >= 2:
        alerts.append({"lvl": "r", "msg": f"{days_since} days without check-in"})
    elif not checked_in:
        alerts.append({"lvl": "am", "msg": "Not checked in today"})

    if latest_meals <= 2:
        alerts.append({"lvl": "am", "msg": f"Meals {latest_meals}/5"})
    if latest_steps < coach_steps_goal * 0.5:
        alerts.append({"lvl": "am", "msg": f"Steps very low ({latest_steps})"})
    if latest_stress >= 8:
        alerts.append({"lvl": "am", "msg": f"Stress {latest_stress}/10"})
    if latest_water < 1.5:
        alerts.append({"lvl": "am", "msg": "Hydration critical"})

    return alerts

def calc_body_fat(waist_cm: Optional[float], neck_cm: Optional[float], height_cm: Optional[float], hips_cm: Optional[float] = None, gender: str = "male") -> Optional[float]:
    """US Military Body Fat Formula."""
    if not waist_cm or not neck_cm or not height_cm:
        return None
    if waist_cm <= neck_cm:
        return None

    h_in = height_cm / 2.54
    n_in = neck_cm / 2.54
    w_in = waist_cm / 2.54

    try:
        if gender.lower() == "female" and hips_cm:
            hip_in = hips_cm / 2.54
            val = 163.205 * math.log10(w_in + hip_in - n_in) - 97.684 * math.log10(h_in) - 78.387
        else:
            val = 86.010 * math.log10(w_in - n_in) - 70.041 * math.log10(h_in) + 36.76
        return round(max(3.0, val), 1)
    except Exception:
        return None
