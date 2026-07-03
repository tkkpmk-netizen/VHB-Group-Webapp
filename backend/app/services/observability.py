"""Small in-process metrics registry for the modular monolith baseline."""

from collections import Counter, defaultdict

request_count: Counter[tuple[str, str, int]] = Counter()
request_duration_seconds: defaultdict[tuple[str, str], float] = defaultdict(float)


def render_prometheus() -> str:
    lines = [
        "# HELP vhb_http_requests_total Total HTTP requests.",
        "# TYPE vhb_http_requests_total counter",
    ]
    for (method, path, status), value in sorted(request_count.items()):
        lines.append(
            f'vhb_http_requests_total{{method="{method}",path="{path}",status="{status}"}} {value}'
        )
    lines.extend(
        [
            "# HELP vhb_http_request_duration_seconds_total Cumulative request duration.",
            "# TYPE vhb_http_request_duration_seconds_total counter",
        ]
    )
    for (method, path), duration_value in sorted(request_duration_seconds.items()):
        lines.append(
            "vhb_http_request_duration_seconds_total"
            f'{{method="{method}",path="{path}"}} {duration_value:.6f}'
        )
    return "\n".join(lines) + "\n"
