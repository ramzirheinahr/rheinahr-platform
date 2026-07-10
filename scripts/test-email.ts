
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Starting email test...");
  console.log("SMTP_HOST:", process.env.SMTP_HOST);
  console.log("SMTP_PORT:", process.env.SMTP_PORT);
  console.log("SMTP_USER:", process.env.SMTP_USER);

  // We want to send a test email to info@rheinahr-gmbh.de
  // Since sendEmailToUsers requires a userId to fetch the email, 
  // we will manually use the nodemailer transporter for this test script if no such user exists,
  // or we can just fetch an admin user and send it to them, or create a dummy user.
  // Actually, we can just use the underlying transport directly for a simple test.
  
  const nodemailer = (await import("nodemailer")).default;
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "plattform@rheinahr-gmbh.de",
      to: "info@rheinahr-gmbh.de", // the destination the user requested
      subject: "Test Email from RheinAhr Platform",
      text: "Hello! This is a test email sent from the newly configured SMTP server on the RheinAhr Platform. If you receive this, the email integration is working perfectly.",
      html: "<p>Hello!</p><p>This is a <b>test email</b> sent from the newly configured SMTP server on the RheinAhr Platform.</p><p>If you receive this, the email integration is working perfectly.</p>",
    });

    console.log("Email sent successfully!");
    console.log("Message ID:", info.messageId);
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

main().catch(console.error);
