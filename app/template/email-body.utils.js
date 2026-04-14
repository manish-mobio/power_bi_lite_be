function emailHtml(safeName, safeRole, dashboardLink) {
  return `
<div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.5;">
  <p style="margin: 0 0 12px;">Hello,</p>
  <p style="margin: 0 0 12px;">
    You have been granted access to <strong>${safeName}</strong> as <strong>${safeRole}</strong>.
  </p>
  <p style="margin: 0 0 18px; color: #475569;">
    Click the link below to open the dashboard inside our application.
  </p>
  <a href="${dashboardLink}" target="_blank" rel="noopener noreferrer"
    style="display: inline-block; background: #0f6cbd; color: #fff; padding: 10px 16px; border-radius: 10px; text-decoration: none; font-weight: 700;">
    Open dashboard
  </a>
  <p style="margin: 16px 0 0; color: #64748b; font-size: 12px;">
    If the button doesn’t work, open this URL in your browser:<br/>
    <a href="${dashboardLink}" style="color: #0f6cbd;">${dashboardLink}</a>
  </p>
</div>
`;
}
export default emailHtml;
