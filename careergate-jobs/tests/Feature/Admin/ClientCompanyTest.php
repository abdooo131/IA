<?php

namespace Tests\Feature\Admin;

use App\Models\ClientCompany;
use App\Models\JobPosting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientCompanyTest extends TestCase
{
    use RefreshDatabase;

    public function test_client_company_with_jobs_cannot_be_deleted(): void
    {
        $job = JobPosting::factory()->create();
        $this->actingAs(User::factory()->admin()->create())->delete("/admin/clients/{$job->client_company_id}")->assertSessionHasErrors();
        $this->assertDatabaseHas('client_companies', ['id' => $job->client_company_id]);
    }

    public function test_recruiter_manages_clients_but_cannot_delete(): void
    {
        $recruiter = User::factory()->recruiter()->create();
        $this->actingAs($recruiter)->post('/admin/clients', ['name' => 'Acme Foods', 'email' => 'hr@acme.test'])->assertRedirect();
        $client = ClientCompany::sole();
        $this->actingAs($recruiter)->put("/admin/clients/{$client->id}", ['name' => 'Acme Foods 2'])->assertRedirect();
        $this->assertSame('Acme Foods 2', $client->fresh()->name);
        $this->actingAs($recruiter)->get('/admin/clients')->assertOk()->assertSee('Acme Foods 2');
        $this->actingAs($recruiter)->delete("/admin/clients/{$client->id}")->assertForbidden();
    }

    public function test_admin_deletes_unused_client(): void
    {
        $client = ClientCompany::factory()->create();
        $this->actingAs(User::factory()->admin()->create())->delete("/admin/clients/{$client->id}")->assertRedirect();
        $this->assertModelMissing($client);
    }

    public function test_name_is_required(): void
    {
        $this->actingAs(User::factory()->create())->post('/admin/clients', [])->assertSessionHasErrors('name');
    }
}
