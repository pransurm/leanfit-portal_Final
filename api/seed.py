"""Seed script for LeanFit Portal Firestore database."""
import os
import sys
from datetime import datetime

# Allow running as script directly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.database import get_db
from api.calculations import calc_adherence, calc_streak, classify_traffic_light, calc_body_fat

def seed_database():
    db = get_db()
    print("🌱 Seeding LeanFit Portal Firestore database...")

    # 1. Coach Profile
    coach_ref = db.collection("users").document("coach_ram")
    coach_ref.set({
        "email": "ram@leanfit.io",
        "role": "coach",
        "name": "Ram Dixit",
        "createdAt": datetime.now(timezone.utc).isoformat()
    }, merge=True)
    print("  ✓ Created coach user: Ram Dixit (ram@leanfit.io)")

    # Attempt to set Firebase Custom Claims if Firebase Auth user exists
    try:
        from firebase_admin import auth as firebase_auth
        try:
            u = firebase_auth.get_user_by_email("ram@leanfit.io")
            firebase_auth.set_custom_user_claims(u.uid, {"role": "coach"})
            print("  ✓ Set Firebase custom user claims {'role': 'coach'} for ram@leanfit.io")
        except Exception:
            pass
    except Exception:
        pass

    # 2. Client: Ankit
    ankit_ref = db.collection("clients").document("ankit")
    ankit_data = {
        "name": "Ankit",
        "initials": "AK",
        "email": "ankit@leanfit.io",
        "phase": "Phase I",
        "week": 2,
        "dayNo": 8,
        "startDate": "01-09-2026",
        "endDate": "24-11-2026",
        "startW": 68.05,
        "targetW": 65.0,
        "latestW": 67.50,
        "height": 175.0,
        "city": "Mumbai",
        "prog": "LeanFit 6-Month Transformation",
        "phaseWeeks": 12,
        "coachStepsGoal": 8000,
        "weightUnit": "kg",
        "measUnit": "cm",
        "status": "active",
        "coachNote": "Focusing on post-workout protein intake. Knee pain resolved.",
        "nutriPlan": "• 1800 kcal / day\n• 140g Protein (Eggs, Chicken, Whey)\n• Low GI carbs around workout\n• Hydration 3.0L daily",
        "workPlan": "• 4 Day Upper/Lower Split\n• Progressive Overload on compound lifts\n• 8,000 steps daily average",
        "plansUpdatedAt": datetime.utcnow().isoformat(),
        "latestMeals": 5,
        "latestSteps": 7800,
        "latestWater": 2.8,
        "latestStress": 3,
        "latestEnergy": 8,
        "daysSince": 0,
        "checkedIn": True,
        "streak": 7,
        "adherence": {"meals": 92, "steps": 85, "water": 88, "vitamins": 86, "overall": 88},
        "trafficLight": "g"
    }
    ankit_ref.set(ankit_data, merge=True)

    # Ankit's check-ins (standardized DD-MM-YYYY format)
    checkins = [
        {"date": "1/9", "fullDate": "01-09-2026", "w": 68.05, "e": 7, "sl": 6, "st": 5, "steps": 4200, "wrk": 0, "water": 2.0, "meals": 4, "multi": True, "note": ""},
        {"date": "2/9", "fullDate": "02-09-2026", "w": 67.90, "e": 7, "sl": 7, "st": 4, "steps": 5100, "wrk": 1, "water": 2.5, "meals": 5, "multi": True, "note": ""},
        {"date": "3/9", "fullDate": "03-09-2026", "w": 67.80, "e": 8, "sl": 7, "st": 3, "steps": 6200, "wrk": 2, "water": 2.5, "meals": 5, "multi": False, "note": "Feeling good"},
        {"date": "4/9", "fullDate": "04-09-2026", "w": 68.00, "e": 6, "sl": 6, "st": 5, "steps": 3800, "wrk": 2, "water": 2.0, "meals": 2, "multi": True, "note": "Office dinner"},
        {"date": "5/9", "fullDate": "05-09-2026", "w": 67.70, "e": 8, "sl": 8, "st": 3, "steps": 7200, "wrk": 3, "water": 3.0, "meals": 5, "multi": True, "note": ""},
        {"date": "6/9", "fullDate": "06-09-2026", "w": 67.60, "e": 9, "sl": 8, "st": 2, "steps": 8100, "wrk": 4, "water": 3.0, "meals": 5, "multi": True, "note": "Best day this week"},
        {"date": "7/9", "fullDate": "07-09-2026", "w": 67.50, "e": 8, "sl": 7, "st": 3, "steps": 7800, "wrk": 4, "water": 2.8, "meals": 4, "multi": True, "note": ""},
    ]
    for c in checkins:
        ankit_ref.collection("checkins").document(c["fullDate"]).set({
            **c,
            "createdAt": datetime.utcnow().isoformat()
        }, merge=True)

    # Ankit's measurements
    measurements = [
        {"week": 1, "date": "01-09-2026", "arms": 32.0, "waist": 88.0, "quads": 58.0, "chest": 96.0, "shoulders": 108.0, "hips": 100.0, "neck": 37.0, "bodyFatPct": calc_body_fat(88.0, 37.0, 175.0)},
        {"week": 2, "date": "08-09-2026", "arms": 31.5, "waist": 86.5, "quads": 57.5, "chest": 95.5, "shoulders": 107.0, "hips": 99.0, "neck": 36.5, "bodyFatPct": calc_body_fat(86.5, 36.5, 175.0)},
    ]
    for m in measurements:
        ankit_ref.collection("measurements").document(f"week_{m['week']}").set({
            **m,
            "createdAt": datetime.utcnow().isoformat()
        }, merge=True)

    # Ankit's wins
    wins = [
        {"week": 1, "date": "07-09-2026", "emoji": "🔥", "text": "Hit 8k steps for the first time ever on Friday! Completed all 3 workouts. Slept before midnight 5 nights in a row."},
        {"week": 2, "date": "14-09-2026", "emoji": "💪", "text": "Down 0.55 kg this week. No 3pm crash for the first time in years. Waist down 1.5 cm. Protein target 6 out of 7 days."}
    ]
    for w in wins:
        ankit_ref.collection("wins").document(f"week_{w['week']}").set({
            **w,
            "createdAt": datetime.utcnow().isoformat()
        }, merge=True)

    print("  ✓ Seeded client: Ankit (checkins, measurements, wins, plans)")

    # 3. Client: Ninad Naik
    ninad_ref = db.collection("clients").document("ninad_naik")
    ninad_ref.set({
        "name": "Ninad Naik",
        "initials": "NN",
        "email": "ninad@leanfit.io",
        "phase": "Phase I",
        "week": 1,
        "startDate": "08-09-2026",
        "endDate": "01-12-2026",
        "startW": 71.0,
        "latestW": 70.6,
        "height": 172.0,
        "city": "Mumbai",
        "prog": "6-Month",
        "coachStepsGoal": 8000,
        "status": "active",
        "adherence": {"meals": 65, "steps": 60, "water": 70, "vitamins": 80, "overall": 71},
        "checkedIn": False,
        "streak": 4,
        "latestMeals": 2,
        "latestSteps": 3500,
        "latestWater": 1.5,
        "latestStress": 7,
        "latestEnergy": 5,
        "daysSince": 1,
        "coachNote": "Struggling with travel and hotel food.",
        "trafficLight": "am"
    }, merge=True)
    print("  ✓ Seeded client: Ninad Naik")

    # 4. Client: Srikanth
    srikanth_ref = db.collection("clients").document("srikanth")
    srikanth_ref.set({
        "name": "Srikanth",
        "initials": "SK",
        "email": "srikanth@leanfit.io",
        "phase": "Phase I",
        "week": 3,
        "startDate": "25-08-2026",
        "endDate": "18-11-2026",
        "startW": 85.0,
        "latestW": 83.4,
        "height": 180.0,
        "city": "Bangalore",
        "prog": "3-Month",
        "coachStepsGoal": 10000,
        "status": "active",
        "adherence": {"meals": 95, "steps": 92, "water": 90, "vitamins": 90, "overall": 92},
        "checkedIn": True,
        "streak": 15,
        "latestMeals": 5,
        "latestSteps": 9200,
        "latestWater": 3.0,
        "latestStress": 2,
        "latestEnergy": 9,
        "daysSince": 0,
        "coachNote": "Crushing his targets consistently.",
        "trafficLight": "g"
    }, merge=True)
    print("  ✓ Seeded client: Srikanth")

    # 5. Client: Gaurav (Paused)
    gaurav_ref = db.collection("clients").document("gaurav")
    gaurav_ref.set({
        "name": "Gaurav",
        "initials": "GV",
        "email": "gaurav@leanfit.io",
        "phase": "Phase I",
        "week": 1,
        "startDate": "10-09-2026",
        "endDate": "10-03-2027",
        "startW": 92.0,
        "latestW": 91.5,
        "height": 178.0,
        "city": "Delhi",
        "prog": "6-Month",
        "coachStepsGoal": 8000,
        "status": "paused",
        "pauseReason": "Travel / Work Trip",
        "resumeDate": "20-09-2026",
        "adherence": {"meals": 60, "steps": 50, "water": 60, "vitamins": 50, "overall": 65},
        "checkedIn": False,
        "streak": 2,
        "latestMeals": 1,
        "latestSteps": 2100,
        "latestWater": 1.0,
        "latestStress": 9,
        "latestEnergy": 3,
        "daysSince": 3,
        "coachNote": "On family trip, resumes 20th Sep.",
        "trafficLight": "am"
    }, merge=True)
    print("  ✓ Seeded client: Gaurav (Paused)")

    print("\n✅ Seeding complete!")

if __name__ == "__main__":
    try:
        seed_database()
    except Exception as e:
        print(f"⚠️ Seeding notice (requires GCP ADC / emulator): {e}")
