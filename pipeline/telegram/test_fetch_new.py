import unittest

from fetch_new import rich_block, rich_text


def typed(name, **values):
    value = type(name, (), {})()
    for key, item in values.items():
        setattr(value, key, item)
    return value


class CachedPageConversionTest(unittest.TestCase):
    def test_rich_text_keeps_nested_formatting_and_links(self):
        value = typed("TextConcat", texts=[typed("TextPlain", text="Открыть "), typed("TextUrl", url="https://nearventure.ru", text=typed("TextBold", text=typed("TextPlain", text="Nearventure")))])
        self.assertEqual(rich_text(value)["text"][1]["href"], "https://nearventure.ru")
        self.assertEqual(rich_text(value)["text"][1]["text"]["type"], "bold")

    def test_cached_page_blocks_become_article_headings_paragraphs_and_gallery(self):
        blocks = [
            typed("PageBlockTitle", text=typed("TextPlain", text="Приключение")),
            typed("PageBlockParagraph", text=typed("TextPlain", text="Текст")),
            typed("PageBlockSlideshow", items=[typed("PageBlockPhoto", photo_id=1), typed("PageBlockPhoto", photo_id=2)]),
        ]
        converted = [node for block in blocks for node in rich_block(block, {1:"media/one.jpg",2:"media/two.jpg"})]
        self.assertEqual(converted[0], {"type":"heading","level":1,"text":{"type":"plain","text":"Приключение"}})
        self.assertEqual(converted[2]["items"][1]["photo"], "media/two.jpg")


if __name__ == "__main__":
    unittest.main()
