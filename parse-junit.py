"""Parse bounded, untrusted JUnit without resolving entities or executing repository code."""
import json
import sys
import xml.etree.ElementTree as ET


def parse_junit(data):
    if len(data) > 262144:
        raise ValueError('JUnit report exceeds 256 KiB')
    text = data.decode('utf-8-sig')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('DTD and entities are not supported')
    root = ET.fromstring(text)
    if root.tag not in ('testsuite', 'testsuites'):
        raise ValueError('Expected JUnit testsuite(s)')
    cases = []

    def suite(node, depth=0):
        if depth > 20:
            raise ValueError('JUnit nesting too deep')
        counts = dict(tests=0, failures=0, errors=0, skipped=0)
        for child in node:
            if child.tag in ('testsuite', 'testsuites'):
                nested = suite(child, depth + 1)
                for key in counts:
                    counts[key] += nested[key]
            elif child.tag == 'testcase':
                flags = [key for key, tag in [('failures', 'failure'), ('errors', 'error'), ('skipped', 'skipped')] if child.find(tag) is not None]
                if len(flags) > 1:
                    raise ValueError('Ambiguous testcase status')
                counts['tests'] += 1
                if flags:
                    counts[flags[0]] += 1
                status = {'failures': 'FAIL', 'errors': 'ERROR', 'skipped': 'SKIPPED'}.get(flags[0] if flags else '', 'PASS')
                if len(cases) < 200:
                    cases.append(dict(name=child.get('name', '')[:300], classname=child.get('classname', '')[:300], status=status))
        for key, count in counts.items():
            if key in node.attrib and (not node.attrib[key].isdigit() or int(node.attrib[key]) != count):
                raise ValueError('JUnit totals disagree with testcase entries: ' + key)
        return counts

    counts = suite(root)
    counts['passed'] = counts['tests'] - counts['failures'] - counts['errors'] - counts['skipped']
    return dict(**counts, cases=cases, casesTruncated=counts['tests'] > len(cases))


if __name__ == '__main__':
    try:
        print(json.dumps(parse_junit(sys.stdin.buffer.read(262145)), ensure_ascii=True))
    except (ValueError, ET.ParseError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
