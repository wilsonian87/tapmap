"""Tests for detect_tag_context() — pharma defaults and custom keywords."""

import pytest
from crawler.extractor import detect_tag_context, _detect_pharma_builtin


class TestPharmaDefaults:
    """When tag_name="Pharma" and no custom keywords, use built-in patterns."""

    def test_isi_detection(self):
        result = detect_tag_context("View Important Safety Information", tag_name="Pharma")
        assert result == "isi:important safety information"

    def test_adverse_event_detection(self):
        result = detect_tag_context("Report Side Effects", tag_name="Pharma")
        assert result == "adverse_event:report side effects"

    def test_patient_enrollment_detection(self):
        result = detect_tag_context("Sign up for savings card", tag_name="Pharma")
        assert result == "patient_enrollment:savings card"

    def test_hcp_gate_detection(self):
        result = detect_tag_context("Are you a healthcare professional?", tag_name="Pharma")
        assert result == "hcp_gate:are you a healthcare professional"

    def test_fair_balance_detection(self):
        result = detect_tag_context("Indications and Usage", tag_name="Pharma")
        assert result == "fair_balance:indications and usage"

    def test_url_prescribing_info(self):
        result = detect_tag_context("Download PDF", url="https://example.com/prescribing-info.pdf", tag_name="Pharma")
        assert result == "isi:prescribing information"

    def test_url_medication_guide(self):
        result = detect_tag_context("Guide", url="https://example.com/medication-guide", tag_name="Pharma")
        assert result == "isi:medication guide"

    def test_no_match(self):
        result = detect_tag_context("Click here to learn more", tag_name="Pharma")
        assert result is None

    def test_none_text(self):
        result = detect_tag_context(None, tag_name="Pharma")
        assert result is None

    def test_category_keyword_format(self):
        """Verify category:keyword format is returned."""
        result = detect_tag_context("View Full Prescribing Information", tag_name="Pharma")
        assert ":" in result
        category, keyword = result.split(":", 1)
        assert category == "isi"
        assert keyword == "full prescribing information"


class TestCustomKeywords:
    """When custom tag_name + keywords are provided, use substring matching."""

    def test_keyword_match_text(self):
        result = detect_tag_context(
            "Read our cookie policy here",
            tag_name="Compliance",
            keywords=["cookie policy", "privacy notice"],
        )
        assert result == "custom:cookie policy"

    def test_keyword_match_url(self):
        result = detect_tag_context(
            "Learn more",
            url="https://example.com/privacy-notice",
            tag_name="Legal",
            keywords=["privacy-notice", "terms"],
        )
        assert result == "custom:privacy-notice"

    def test_keyword_case_insensitive(self):
        result = detect_tag_context(
            "COOKIE POLICY",
            tag_name="Compliance",
            keywords=["cookie policy"],
        )
        assert result == "custom:cookie policy"

    def test_no_keyword_match(self):
        result = detect_tag_context(
            "Click here to learn more",
            tag_name="Compliance",
            keywords=["cookie policy", "privacy notice"],
        )
        assert result is None

    def test_empty_keywords_list(self):
        result = detect_tag_context(
            "Important Safety Information",
            tag_name="Custom",
            keywords=[],
        )
        assert result is None

    def test_none_text_custom(self):
        result = detect_tag_context(
            None,
            tag_name="Custom",
            keywords=["keyword"],
        )
        assert result is None

    def test_first_keyword_wins(self):
        """When multiple keywords match, the first one in the list is returned."""
        result = detect_tag_context(
            "Read our cookie policy and privacy notice",
            tag_name="Compliance",
            keywords=["cookie policy", "privacy notice"],
        )
        assert result == "custom:cookie policy"


class TestBuiltinHelper:
    """Direct tests for _detect_pharma_builtin."""

    def test_returns_category_keyword(self):
        result = _detect_pharma_builtin("Report adverse events")
        assert result == "adverse_event:adverse event"

    def test_returns_none_no_match(self):
        assert _detect_pharma_builtin("Just a regular button") is None
