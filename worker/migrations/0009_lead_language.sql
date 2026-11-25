-- The customer's language for the bot ('en' / 'te'); NULL until it is known (asked, or seen in their messages).
ALTER TABLE leads ADD COLUMN language TEXT;
