"""Sending email (password reset) over plain SMTP, so any provider works: Gmail (app password), Brevo, Zoho, Amazon SES.

Without SMTP settings nothing is sent: the message is written to the server log instead, so a local install still
works (the admin copies the link from the log)."""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

from app.core.config import get_settings

log = logging.getLogger(__name__)


def configured() -> bool:
    s = get_settings()
    return bool(s.smtp_host and s.smtp_from)


def send(to: str, subject: str, text: str) -> bool:
    """True when handed to the mail server; False when email is not set up (logged instead) or the server refused."""
    s = get_settings()
    if not configured():
        log.warning("email is not set up (SMTP_HOST / SMTP_FROM); would have sent to %s: %s\n%s", to, subject, text)
        return False
    name, addr = parseaddr(s.smtp_from)
    msg = EmailMessage()
    msg["From"] = formataddr((name or s.business_name, addr))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        if s.smtp_ssl:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ssl.create_default_context(), timeout=20) as smtp:
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password.get_secret_value())
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password.get_secret_value())
                smtp.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as exc:
        log.warning("email to %s failed: %s", to, exc)
        return False
