import tempfile
import unittest
from pathlib import Path

from check_test_reports import check_reports


class ReportGateTest(unittest.TestCase):
    def test_missing_or_empty_reports_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                check_reports(root, [])
            (root / "report.xml").write_text('<testsuite tests="0"/>')
            with self.assertRaises(ValueError):
                check_reports(root, [])

    def test_skips_fail_even_when_the_runner_exits_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for tag in ("skipped", "failure", "error"):
                (root / "report.xml").write_text(
                    f'<testsuite><testcase classname="Canary"><{tag}/></testcase></testsuite>')
                with self.assertRaises(ValueError):
                    check_reports(root, ["Canary"])

    def test_required_canary_cannot_disappear(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "report.xml").write_text('<testsuite><testcase classname="Unit"/></testsuite>')
            with self.assertRaises(ValueError):
                check_reports(root, ["DatabaseCanary"])

    def test_accepts_green_canaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "report.xml").write_text('<testsuites><testsuite><testcase classname="Canary"/></testsuite></testsuites>')
            self.assertEqual(check_reports(root, ["Canary"]), 1)


if __name__ == "__main__":
    unittest.main()
