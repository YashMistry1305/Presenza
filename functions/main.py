# Welcome to Cloud Functions for Firebase for Python!
# To get started, simply uncomment the below code or create your own.
# Deploy with `firebase deploy`

from firebase_functions import https_fn
from firebase_functions.options import set_global_options
import csv
import io
import json
import urllib.request


# For cost control, you can set the maximum number of containers that can be
# running at the same time. This helps mitigate the impact of unexpected
# traffic spikes by instead downgrading performance. This limit is a per-function
# limit. You can override the limit for each function using the max_instances
# parameter in the decorator, e.g. @https_fn.on_request(max_instances=5).
set_global_options(max_instances=10)

@https_fn.on_request()
def generateReport(req: https_fn.Request) -> https_fn.Response:
	# Basic CORS handling
	if req.method == "OPTIONS":
		return https_fn.Response(
			"",
			status=204,
			headers={
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			},
		)

	if req.method != "POST":
		return https_fn.Response(
			"Method not allowed",
			status=405,
			headers={"Access-Control-Allow-Origin": "*"},
		)

	data = req.get_json(silent=True) or {}
	email = data.get("email")
	practical_path = data.get("practicalPath")
	practical_url = data.get("practicalUrl")
	theory_path = data.get("theoryPath")
	theory_url = data.get("theoryUrl")

	if not email or not practical_path or not practical_url or not theory_path or not theory_url:
		return https_fn.Response(
			"Missing required fields",
			status=400,
			headers={"Access-Control-Allow-Origin": "*"},
		)

	def normalize_header(header: str) -> str:
		return "".join(header.lower().split())

	def fetch_csv(url: str):
		try:
			with urllib.request.urlopen(url) as response:
				csv_bytes = response.read()
			csv_text = csv_bytes.decode("utf-8", errors="ignore")
			table = list(csv.reader(io.StringIO(csv_text)))

			def is_header_row(row):
				normalized = {normalize_header(cell) for cell in row if cell}
				return (
					any(key in normalized for key in ["rollno", "rollnumber", "roll"]) and
					any(key in normalized for key in ["name", "studentname"]) and
					any(key in normalized for key in ["class", "classname"])
				)

			header_index = None
			for idx, row in enumerate(table):
				if is_header_row(row):
					header_index = idx
					break

			if header_index is None:
				reader = csv.DictReader(io.StringIO(csv_text))
				headers = reader.fieldnames or []
				rows = list(reader)
				return headers, rows, None

			headers = [cell.strip() for cell in table[header_index]]
			data_rows = table[header_index + 1 :]
			rows = []
			for data in data_rows:
				if not any(cell.strip() for cell in data if cell is not None):
					continue
				row = {}
				for col_index, header in enumerate(headers):
					if header == "":
						continue
					value = data[col_index] if col_index < len(data) else ""
					row[header] = value
				rows.append(row)
			return headers, rows, None
		except Exception as exc:
			return [], [], exc

	practical_headers, practical_rows, practical_error = fetch_csv(practical_url)
	theory_headers, theory_rows, theory_error = fetch_csv(theory_url)

	if practical_error or theory_error:
		return https_fn.Response(
			f"Failed to fetch CSV: {practical_error or theory_error}",
			status=400,
			headers={"Access-Control-Allow-Origin": "*"},
		)

	def build_header_map(headers):
		mapping = {}
		for header in headers:
			mapping[normalize_header(header)] = header
		return mapping

	def get_value(row, header_map, *keys):
		for key in keys:
			actual = header_map.get(key)
			if actual and actual in row:
				return (row.get(actual) or "").strip()
		return ""

	def get_numeric_values(row, headers, header_map):
		ignore_keys = {"rollno", "rollnumber", "roll", "class", "classname", "name", "studentname"}
		values = []
		for header in headers:
			if normalize_header(header) in ignore_keys:
				continue
			raw = (row.get(header) or "").strip()
			if raw == "":
				continue
			try:
				values.append(float(raw))
			except ValueError:
				continue
		return values

	practical_header_map = build_header_map(practical_headers)
	theory_header_map = build_header_map(theory_headers)

	def build_key(row, header_map):
		roll = get_value(row, header_map, "rollno", "rollnumber", "roll")
		class_name = get_value(row, header_map, "class", "classname")
		name = get_value(row, header_map, "name", "studentname")
		if roll:
			return roll, roll, class_name, name
		return f"{class_name}|{name}", roll, class_name, name

	practical_map = {}
	practical_preview = []
	for row in practical_rows:
		key, roll, class_name, name = build_key(row, practical_header_map)
		values = get_numeric_values(row, practical_headers, practical_header_map)
		practical_avg = sum(values) / len(values) if values else 0.0
		practical_map[key] = {
			"rollNo": roll,
			"class": class_name,
			"name": name,
			"practicalPercent": practical_avg,
		}
		practical_preview.append(
			{
				"rollNo": roll,
				"class": class_name,
				"name": name,
				"average": practical_avg,
			}
		)

	theory_map = {}
	theory_preview = []
	for row in theory_rows:
		key, roll, class_name, name = build_key(row, theory_header_map)
		values = get_numeric_values(row, theory_headers, theory_header_map)
		theory_avg = sum(values) / len(values) if values else 0.0
		theory_map[key] = {
			"rollNo": roll,
			"class": class_name,
			"name": name,
			"theoryPercent": theory_avg,
		}
		theory_preview.append(
			{
				"rollNo": roll,
				"class": class_name,
				"name": name,
				"average": theory_avg,
			}
		)

	overall_defaulters = []
	practical_defaulters = []
	theory_defaulters = []

	all_keys = set(practical_map.keys()) | set(theory_map.keys())

	for key in all_keys:
		practical_entry = practical_map.get(key, {})
		theory_entry = theory_map.get(key, {})

		roll_no = practical_entry.get("rollNo") or theory_entry.get("rollNo") or ""
		class_name = practical_entry.get("class") or theory_entry.get("class") or ""
		name = practical_entry.get("name") or theory_entry.get("name") or ""
		practical_pct = practical_entry.get("practicalPercent", 0.0)
		theory_pct = theory_entry.get("theoryPercent", 0.0)
		overall_pct = (practical_pct + theory_pct) / 2

		entry = {
			"rollNo": roll_no,
			"class": class_name,
			"name": name,
			"practicalPercent": practical_pct,
			"theoryPercent": theory_pct,
			"overallPercent": overall_pct,
		}

		if practical_pct < 75:
			practical_defaulters.append(entry)

		if theory_pct < 75:
			theory_defaulters.append(entry)

		if overall_pct < 75:
			overall_defaulters.append(entry)

	def roll_sort_key(item):
		raw = str(item.get("rollNo") or "")
		try:
			return float(raw)
		except ValueError:
			return float("inf")

	overall_defaulters.sort(key=roll_sort_key)
	practical_defaulters.sort(key=roll_sort_key)
	theory_defaulters.sort(key=roll_sort_key)

	payload = {
		"practicalPreview": practical_preview,
		"theoryPreview": theory_preview,
		"overallDefaulters": overall_defaulters,
		"practicalDefaulters": practical_defaulters,
		"theoryDefaulters": theory_defaulters,
	}

	return https_fn.Response(
		json.dumps(payload),
		status=200,
		headers={
			"Access-Control-Allow-Origin": "*",
			"Content-Type": "application/json",
		},
	)