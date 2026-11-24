<?php

namespace Tests\Unit;

use App\Enums\Stage;
use App\Events\ApplicationStageChanged;
use App\Models\Application;
use App\Models\User;
use App\Services\StageService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class StageServiceTest extends TestCase
{
    use RefreshDatabase;

    public function test_move_records_history_and_event(): void
    {
        Event::fake([ApplicationStageChanged::class]);
        $app = Application::factory()->create();
        $u = User::factory()->create();
        $this->assertTrue(app(StageService::class)->move($app, Stage::Shortlisted, $u));
        $this->assertFalse(app(StageService::class)->move($app, Stage::Shortlisted, $u));
        $this->assertSame(1, $app->stageChanges()->where('to_stage', 'shortlisted')->count());
        Event::assertDispatchedTimes(ApplicationStageChanged::class, 1);
    }

    public function test_any_stage_can_move_to_any_stage(): void
    {
        $app = Application::factory()->create(['stage' => Stage::Hired]);
        app(StageService::class)->move($app, Stage::New, User::factory()->create());
        $this->assertSame(Stage::New, $app->fresh()->stage);
    }
}
