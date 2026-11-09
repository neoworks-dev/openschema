package kitchen

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/neoworks-dev/sdk-go/collections"
)

// What the core writes for a Recipe, in the descriptor's JSON mapping.
const coreRecipe = `{
  "pantry": "0f6c5a52-0000-4000-8000-000000000001",
  "title": "Soup",
  "notes": "Needs salt",
  "servings": 4,
  "calories": 312.5,
  "views": "-9007199254740993",
  "totalViews": "18446744073709551615",
  "cookTime": "5400000000000",
  "cookedAt": "2026-10-05T08:00:00.000Z",
  "day": "2026-10-05",
  "startsAt": "08:30:00",
  "token": "3f2c1d34-1111-4222-8333-444455556666",
  "photoData": "_-8",
  "thumbnail": "AQID",
  "extra": {"a":[1,2,{"b":null}]},
  "annotations": "text",
  "version": "1.2.3",
  "price": "12.50",
  "favourite": true,
  "level": 200,
  "difficulty": "hard",
  "mood": "easy",
  "tags": ["vegan", "quick"],
  "allergens": [],
  "counts": ["1", "-9223372036854775808"],
  "digits": [1, 2, 255],
  "stamps": ["2026-10-05T08:00:00.000Z"],
  "blobs": ["AQID", ""],
  "related": ["0f6c5a52-0000-4000-8000-000000000002"],
  "nutrition": {"fat": 1.5},
  "weights": {"flour": "9223372036854775807"},
  "byYear": {"2026": "good", "-1": "old"},
  "flags": {"true": "yes", "false": "no"},
  "author": {"name": "Ana"},
  "facts": {"energy": 100, "allergens": [{"name": "nuts"}]},
  "steps": [{"text": "Boil", "photo": {"objectId": "a", "name": "p.jpg", "mediaType": "image/jpeg", "size": "10", "variants": {}}}],
  "sections": [{"title": "One", "child": {"title": "Two"},"subsections": [{"title": "Three"}]}],
  "cover": {"objectId": "b", "name": "c.jpg", "mediaType": "image/jpeg", "size": "18446744073709551615", "variants": {"thumb": {"objectId": "c", "size": "3"}}},
  "gallery": [{"objectId": "d", "name": "d.jpg", "mediaType": "image/jpeg", "size": "1", "variants": {}}],
  "reminder": {"when": {"count": "7"}},
  "source": {"cookbook": "12"}
}`

func decodeRecipe(t *testing.T, text string) Recipe {
	t.Helper()
	var recipe Recipe
	if err := json.Unmarshal([]byte(text), &recipe); err != nil {
		t.Fatalf("decoding the core's content: %v", err)
	}
	return recipe
}

func TestDecodesTheCoresContent(t *testing.T) {
	recipe := decodeRecipe(t, coreRecipe)

	if recipe.Views != -9007199254740993 || *recipe.TotalViews != 18446744073709551615 {
		t.Errorf("64-bit integers: %d %d", recipe.Views, *recipe.TotalViews)
	}
	if recipe.CookTime != 90*time.Minute {
		t.Errorf("duration: %v", recipe.CookTime)
	}
	if !recipe.CookedAt.Equal(time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC)) {
		t.Errorf("timestamp: %v", recipe.CookedAt)
	}
	if string(recipe.PhotoData) != "\xff\xef" || !reflect.DeepEqual([]byte(*recipe.Thumbnail), []byte{1, 2, 3}) {
		t.Errorf("bytes: %q %v", recipe.PhotoData, *recipe.Thumbnail)
	}
	if recipe.Difficulty != DifficultyHard || *recipe.Mood != DifficultyEasy {
		t.Errorf("enums: %q %q", recipe.Difficulty, *recipe.Mood)
	}
	if recipe.Counts[1] != -9223372036854775808 || recipe.Digits[2] != 255 {
		t.Errorf("list elements: %v %v", recipe.Counts, recipe.Digits)
	}
	if recipe.Weights["flour"] != 9223372036854775807 || recipe.ByYear[-1] != "old" || recipe.Flags["true"] != "yes" {
		t.Errorf("maps: %v %v %v", recipe.Weights, recipe.ByYear, recipe.Flags)
	}
	if recipe.Cover.Variants["thumb"].Size != 3 || recipe.Cover.Size != 18446744073709551615 {
		t.Errorf("file: %+v", recipe.Cover)
	}
	if recipe.Reminder.When == nil || *recipe.Reminder.When.Count != 7 || *recipe.Source.Cookbook != 12 {
		t.Errorf("oneofs: %+v %+v", recipe.Reminder, recipe.Source)
	}
	if recipe.Sections[0].Child.Title != "Two" || recipe.Sections[0].Subsections[0].Title != "Three" {
		t.Errorf("sections: %+v", recipe.Sections)
	}
	if string(recipe.Extra) != `{"a":[1,2,{"b":null}]}` {
		t.Errorf("json: %s", recipe.Extra)
	}
}

func TestEncodesWhatTheCoreReads(t *testing.T) {
	recipe := decodeRecipe(t, coreRecipe)
	encoded, err := json.Marshal(recipe)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}

	expected := map[string]any{
		"views":      "-9007199254740993",
		"totalViews": "18446744073709551615",
		"cookTime":   "5400000000000",
		"photoData":  "_-8",
		"thumbnail":  "AQID",
		"counts":     []any{"1", "-9223372036854775808"},
		"digits":     []any{1.0, 2.0, 255.0},
		"byYear":     map[string]any{"2026": "good", "-1": "old"},
		"weights":    map[string]any{"flour": "9223372036854775807"},
		"reminder":   map[string]any{"when": map[string]any{"count": "7"}},
		"source":     map[string]any{"cookbook": "12"},
		"level":      200.0,
	}
	for name, want := range expected {
		if !reflect.DeepEqual(fields[name], want) {
			t.Errorf("%s: got %#v, want %#v", name, fields[name], want)
		}
	}
}

func TestRoundTripKeepsEveryValue(t *testing.T) {
	first := decodeRecipe(t, coreRecipe)
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	second := decodeRecipe(t, string(encoded))
	if !reflect.DeepEqual(first, second) {
		t.Errorf("the recipe changed in a round trip:\n%+v\n%+v", first, second)
	}
}

func TestLeavesUnsetOptionalFieldsOut(t *testing.T) {
	recipe := Recipe{Source: RecipeSource{Url: new(string)}, Extra: json.RawMessage("null")}
	encoded, err := json.Marshal(recipe)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"notes", "totalViews", "lastCooked", "thumbnail", "annotations", "mood", "author", "cover", "reminder", "tags"} {
		if _, present := fields[name]; present {
			t.Errorf("%s is written although it is unset", name)
		}
	}
	for _, name := range []string{"allergens", "stamps", "weights", "sections"} {
		if value, present := fields[name]; !present || value != nil {
			t.Errorf("%s: an unset optional list is null, got %#v", name, value)
		}
	}
}

func TestRefusesAOneofWithoutVariant(t *testing.T) {
	if _, err := json.Marshal(RecipeSource{}); err == nil {
		t.Error("a oneof with no variant was written")
	}
	var source RecipeSource
	if err := json.Unmarshal([]byte(`{"nothing": 1}`), &source); err == nil {
		t.Error("an unknown variant was read")
	}
}

func TestFieldHandlesCompile(t *testing.T) {
	_ = RecipeFields.Title.Contains("soup")
	_ = RecipeFields.Servings.Gt(2)
	_ = RecipeFields.CookedAt.Desc()
	_ = RecipeFields.Difficulty.Set(DifficultyHard)
	_ = RecipeFields.Cover.Name.Contains("jpg")
	_ = RecipeFields.Tags.Some(func(tag collections.StringField) collections.Condition { return tag.Equals("vegan") })
	_ = RecipeFields.Steps.Some(func(step StepFieldHandles) collections.Condition { return step.Text.Contains("boil") })
	_ = RecipeFields.Author.Name.Equals("Ana")
	_ = RecipeFields.Author.Set(Author{Name: "Ana"})
	_ = RecipeFields.Sections.Some(func(section SectionFieldHandles) collections.Condition { return section.Child().Title.Equals("x") })
	_ = RecipeFields.Pantry.Set("id")
	_ = RecipeFields.Reminder.Clear()
}
