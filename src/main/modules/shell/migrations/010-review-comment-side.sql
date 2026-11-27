ALTER TABLE review_comments ADD COLUMN side TEXT CHECK (side IN ('before', 'after'));
