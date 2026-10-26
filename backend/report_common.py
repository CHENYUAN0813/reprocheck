"""Small compatibility helpers for the existing report JSON contract."""
import json
import math
import re
from decimal import Decimal


def find(pattern, text, flags=0):
    return re.search(pattern, text, flags | re.ASCII)


def matches(pattern, text, flags=0):
    return re.finditer(pattern, text, flags | re.ASCII)


def group(pattern, text, flags=0, index=1):
    result = find(pattern, text, flags)
    return result[index] if result else None


def lines(text):
    return re.split(r'\r?\n', text)


def clip(text, length):
    # Report source excerpts and JS keys are measured in UTF-16 code units.
    return text.encode('utf-16-le', errors='surrogatepass')[:length * 2].decode('utf-16-le', errors='surrogatepass')


def source(file, line, text):
    return dict(file=file, line=line, text=clip(text.strip(), 500))


def quote(text):
    return "'" + text.replace("'", "'\"'\"'") + "'"


def unique(values):
    return list(dict.fromkeys(values))


def canonical(value):
    """Preserve the existing JS protocol fingerprint, including numeric spelling."""
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode('utf-16-be', errors='surrogatepass'))
        return '{' + ','.join(canonical(key) + ':' + canonical(value[key]) for key in keys) + '}'
    if isinstance(value, list):
        return '[' + ','.join(canonical(item) for item in value) + ']'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if not math.isfinite(number):
            return 'null'
        if number == 0:
            return '0'
        raw = repr(number)
        if 1e-6 <= abs(number) < 1e21:
            return format(Decimal(raw), 'f').rstrip('0').rstrip('.') if '.' in format(Decimal(raw), 'f') else format(Decimal(raw), 'f')
        mantissa, exponent = raw.split('e') if 'e' in raw else (raw, '0')
        exponent = int(exponent)
        return mantissa.removesuffix('.0') + 'e' + ('+' if exponent >= 0 else '-') + str(abs(exponent))
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    return re.sub(r'[\ud800-\udfff]', lambda m: f'\\u{ord(m[0]):04x}', encoded)
